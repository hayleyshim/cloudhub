package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/NYTimes/gziphandler"
	"github.com/bouk/httprouter"
	cmp "github.com/snetsystems/cmp/backend"
	"github.com/snetsystems/cmp/backend/oauth2"
	"github.com/snetsystems/cmp/backend/roles"
)

const (
	// JSONType the mimetype for a json request
	JSONType = "application/json"
)

// MuxOpts are the options for the router.  Mostly related to auth.
type MuxOpts struct {
	Logger        cmp.Logger
	Develop       bool                 // Develop loads assets from filesystem instead of bindata
	Basepath      string               // URL path prefix under which all cmp routes will be mounted
	UseAuth       bool                 // UseAuth turns on Github OAuth and JWT
	Auth          oauth2.Authenticator // Auth is used to authenticate and authorize
	ProviderFuncs []func(func(oauth2.Provider, oauth2.Mux))
	StatusFeedURL string            // JSON Feed URL for the client Status page News Feed
	CustomLinks   map[string]string // Any custom external links for client's User menu
	PprofEnabled  bool              // Mount pprof routes for profiling
	DisableGZip   bool              // Optionally disable gzip.
}

// NewMux attaches all the route handlers; handler returned servers cmp.
func NewMux(opts MuxOpts, service Service) http.Handler {
	hr := httprouter.New()

	// /* React Application */
	assets := Assets(AssetsOpts{
		Develop: opts.Develop,
		Logger:  opts.Logger,
	})

	if opts.Basepath != "" {
		basePath := fmt.Sprintf("%s/", opts.Basepath)
		// Prefix any URLs found in the React assets with any configured basepath
		assets = NewDefaultURLPrefixer(basePath, assets, opts.Logger)
	}

	// Compress the assets with gzip if an accepted encoding
	if !opts.DisableGZip {
		assets = gziphandler.GzipHandler(assets)
	}

	// The react application handles all the routing if the server does not
	// know about the route.  This means that we never have unknown routes on
	// the server.
	hr.NotFound = assets

	var router cmp.Router = hr

	// Set route prefix for all routes if basepath is present
	if opts.Basepath != "" {
		router = &MountableRouter{
			Prefix:   opts.Basepath,
			Delegate: hr,
		}

		//The assets handler is always unaware of basepaths, so the
		// basepath needs to always be removed before sending requests to it
		hr.NotFound = http.StripPrefix(opts.Basepath, hr.NotFound)
	}

	EnsureMember := func(next http.HandlerFunc) http.HandlerFunc {
		return AuthorizedUser(
			service.Store,
			opts.UseAuth,
			roles.MemberRoleName,
			opts.Logger,
			next,
		)
	}
	_ = EnsureMember
	EnsureViewer := func(next http.HandlerFunc) http.HandlerFunc {
		return AuthorizedUser(
			service.Store,
			opts.UseAuth,
			roles.ViewerRoleName,
			opts.Logger,
			next,
		)
	}
	_ = EnsureViewer
	EnsureEditor := func(next http.HandlerFunc) http.HandlerFunc {
		return AuthorizedUser(
			service.Store,
			opts.UseAuth,
			roles.EditorRoleName,
			opts.Logger,
			next,
		)
	}
	_ = EnsureEditor
	EnsureAdmin := func(next http.HandlerFunc) http.HandlerFunc {
		return AuthorizedUser(
			service.Store,
			opts.UseAuth,
			roles.AdminRoleName,
			opts.Logger,
			next,
		)
	}
	_ = EnsureAdmin
	EnsureSuperAdmin := func(next http.HandlerFunc) http.HandlerFunc {
		return AuthorizedUser(
			service.Store,
			opts.UseAuth,
			roles.SuperAdminStatus,
			opts.Logger,
			next,
		)
	}
	_ = EnsureSuperAdmin
	rawStoreAccess := func(next http.HandlerFunc) http.HandlerFunc {
		return RawStoreAccess(opts.Logger, next)
	}
	_ = rawStoreAccess
	ensureOrgMatches := func(next http.HandlerFunc) http.HandlerFunc {
		return RouteMatchesPrincipal(
			service.Store,
			opts.UseAuth,
			opts.Logger,
			next,
		)
	}
	_ = ensureOrgMatches

	if opts.PprofEnabled {
		// add profiling routes
		router.GET("/debug/pprof/:thing", http.DefaultServeMux.ServeHTTP)
	}

	/* Documentation */
	// router.GET("/swagger.json", Spec())
	// router.GET("/docs", Redoc("/swagger.json"))

	/* API */
	// Organizations
	router.GET("/cmp/v1/organizations", EnsureAdmin(service.Organizations))
	router.POST("/cmp/v1/organizations", EnsureSuperAdmin(service.NewOrganization))

	router.GET("/cmp/v1/organizations/:oid", EnsureAdmin(service.OrganizationID))
	router.PATCH("/cmp/v1/organizations/:oid", EnsureSuperAdmin(service.UpdateOrganization))
	router.DELETE("/cmp/v1/organizations/:oid", EnsureSuperAdmin(service.RemoveOrganization))

	// Mappings
	router.GET("/cmp/v1/mappings", EnsureSuperAdmin(service.Mappings))
	router.POST("/cmp/v1/mappings", EnsureSuperAdmin(service.NewMapping))

	router.PUT("/cmp/v1/mappings/:id", EnsureSuperAdmin(service.UpdateMapping))
	router.DELETE("/cmp/v1/mappings/:id", EnsureSuperAdmin(service.RemoveMapping))

	// Sources
	router.GET("/cmp/v1/sources", EnsureViewer(service.Sources))
	router.POST("/cmp/v1/sources", EnsureEditor(service.NewSource))

	router.GET("/cmp/v1/sources/:id", EnsureViewer(service.SourcesID))
	router.PATCH("/cmp/v1/sources/:id", EnsureEditor(service.UpdateSource))
	router.DELETE("/cmp/v1/sources/:id", EnsureEditor(service.RemoveSource))
	router.GET("/cmp/v1/sources/:id/health", EnsureViewer(service.SourceHealth))

	// Flux
	router.GET("/cmp/v1/flux", EnsureViewer(service.Flux))
	router.POST("/cmp/v1/flux/ast", EnsureViewer(service.FluxAST))
	router.GET("/cmp/v1/flux/suggestions", EnsureViewer(service.FluxSuggestions))
	router.GET("/cmp/v1/flux/suggestions/:name", EnsureViewer(service.FluxSuggestion))

	// Source Proxy to Influx; Has gzip compression around the handler
	influx := gziphandler.GzipHandler(EnsureViewer(service.Influx))
	router.Handler("POST", "/cmp/v1/sources/:id/proxy", influx)

	// Source Proxy to Influx's flux endpoint; compression because the responses from
	// flux could be large.
	router.POST("/cmp/v1/sources/:id/proxy/flux", EnsureViewer(service.ProxyFlux))

	// Write proxies line protocol write requests to InfluxDB
	router.POST("/cmp/v1/sources/:id/write", EnsureViewer(service.Write))

	// Queries is used to analyze a specific queries and does not create any
	// resources. It's a POST because Queries are POSTed to InfluxDB, but this
	// only modifies InfluxDB resources with certain metaqueries, e.g. DROP DATABASE.
	//
	// Admins should ensure that the InfluxDB source as the proper permissions
	// intended for CMP Users with the Viewer Role type.
	router.POST("/cmp/v1/sources/:id/queries", EnsureViewer(service.Queries))

	// Annotations are user-defined events associated with this source
	router.GET("/cmp/v1/sources/:id/annotations", EnsureViewer(service.Annotations))
	router.POST("/cmp/v1/sources/:id/annotations", EnsureEditor(service.NewAnnotation))
	router.GET("/cmp/v1/sources/:id/annotations/:aid", EnsureViewer(service.Annotation))
	router.DELETE("/cmp/v1/sources/:id/annotations/:aid", EnsureEditor(service.RemoveAnnotation))
	router.PATCH("/cmp/v1/sources/:id/annotations/:aid", EnsureEditor(service.UpdateAnnotation))

	// All possible permissions for users in this source
	router.GET("/cmp/v1/sources/:id/permissions", EnsureViewer(service.Permissions))

	// Users associated with the data source
	router.GET("/cmp/v1/sources/:id/users", EnsureAdmin(service.SourceUsers))
	router.POST("/cmp/v1/sources/:id/users", EnsureAdmin(service.NewSourceUser))

	router.GET("/cmp/v1/sources/:id/users/:uid", EnsureAdmin(service.SourceUserID))
	router.DELETE("/cmp/v1/sources/:id/users/:uid", EnsureAdmin(service.RemoveSourceUser))
	router.PATCH("/cmp/v1/sources/:id/users/:uid", EnsureAdmin(service.UpdateSourceUser))

	// Roles associated with the data source
	router.GET("/cmp/v1/sources/:id/roles", EnsureViewer(service.SourceRoles))
	router.POST("/cmp/v1/sources/:id/roles", EnsureEditor(service.NewSourceRole))

	router.GET("/cmp/v1/sources/:id/roles/:rid", EnsureViewer(service.SourceRoleID))
	router.DELETE("/cmp/v1/sources/:id/roles/:rid", EnsureEditor(service.RemoveSourceRole))
	router.PATCH("/cmp/v1/sources/:id/roles/:rid", EnsureEditor(service.UpdateSourceRole))

	// Services are resources that cmp proxies to
	router.GET("/cmp/v1/sources/:id/services", EnsureViewer(service.Services))
	router.POST("/cmp/v1/sources/:id/services", EnsureEditor(service.NewService))
	router.GET("/cmp/v1/sources/:id/services/:kid", EnsureViewer(service.ServiceID))
	router.PATCH("/cmp/v1/sources/:id/services/:kid", EnsureEditor(service.UpdateService))
	router.DELETE("/cmp/v1/sources/:id/services/:kid", EnsureEditor(service.RemoveService))

	// Service Proxy
	router.GET("/cmp/v1/sources/:id/services/:kid/proxy", EnsureViewer(service.ProxyGet))
	router.POST("/cmp/v1/sources/:id/services/:kid/proxy", EnsureEditor(service.ProxyPost))
	router.PATCH("/cmp/v1/sources/:id/services/:kid/proxy", EnsureEditor(service.ProxyPatch))
	router.DELETE("/cmp/v1/sources/:id/services/:kid/proxy", EnsureEditor(service.ProxyDelete))

	// Kapacitor
	router.GET("/cmp/v1/sources/:id/kapacitors", EnsureViewer(service.Kapacitors))
	router.POST("/cmp/v1/sources/:id/kapacitors", EnsureEditor(service.NewKapacitor))

	router.GET("/cmp/v1/sources/:id/kapacitors/:kid", EnsureViewer(service.KapacitorsID))
	router.PATCH("/cmp/v1/sources/:id/kapacitors/:kid", EnsureEditor(service.UpdateKapacitor))
	router.DELETE("/cmp/v1/sources/:id/kapacitors/:kid", EnsureEditor(service.RemoveKapacitor))

	// Kapacitor rules
	router.GET("/cmp/v1/sources/:id/kapacitors/:kid/rules", EnsureViewer(service.KapacitorRulesGet))
	router.POST("/cmp/v1/sources/:id/kapacitors/:kid/rules", EnsureEditor(service.KapacitorRulesPost))

	router.GET("/cmp/v1/sources/:id/kapacitors/:kid/rules/:tid", EnsureViewer(service.KapacitorRulesID))
	router.PUT("/cmp/v1/sources/:id/kapacitors/:kid/rules/:tid", EnsureEditor(service.KapacitorRulesPut))
	router.PATCH("/cmp/v1/sources/:id/kapacitors/:kid/rules/:tid", EnsureEditor(service.KapacitorRulesStatus))
	router.DELETE("/cmp/v1/sources/:id/kapacitors/:kid/rules/:tid", EnsureEditor(service.KapacitorRulesDelete))

	// Kapacitor Proxy
	router.GET("/cmp/v1/sources/:id/kapacitors/:kid/proxy", EnsureViewer(service.ProxyGet))
	router.POST("/cmp/v1/sources/:id/kapacitors/:kid/proxy", EnsureEditor(service.ProxyPost))
	router.PATCH("/cmp/v1/sources/:id/kapacitors/:kid/proxy", EnsureEditor(service.ProxyPatch))
	router.DELETE("/cmp/v1/sources/:id/kapacitors/:kid/proxy", EnsureEditor(service.ProxyDelete))

	// Layouts
	router.GET("/cmp/v1/layouts", EnsureViewer(service.Layouts))
	router.GET("/cmp/v1/layouts/:id", EnsureViewer(service.LayoutsID))

	// Protoboards
	router.GET("/cmp/v1/protoboards", EnsureViewer(service.Protoboards))
	router.GET("/cmp/v1/protoboards/:id", EnsureViewer(service.ProtoboardsID))

	// Users associated with CMP
	router.GET("/cmp/v1/me", service.Me)

	// Set current cmp organization the user is logged into
	router.PUT("/cmp/v1/me", service.UpdateMe(opts.Auth))

	// TODO: what to do about admin's being able to set superadmin
	router.GET("/cmp/v1/organizations/:oid/users", EnsureAdmin(ensureOrgMatches(service.Users)))
	router.POST("/cmp/v1/organizations/:oid/users", EnsureAdmin(ensureOrgMatches(service.NewUser)))

	router.GET("/cmp/v1/organizations/:oid/users/:id", EnsureAdmin(ensureOrgMatches(service.UserID)))
	router.DELETE("/cmp/v1/organizations/:oid/users/:id", EnsureAdmin(ensureOrgMatches(service.RemoveUser)))
	router.PATCH("/cmp/v1/organizations/:oid/users/:id", EnsureAdmin(ensureOrgMatches(service.UpdateUser)))

	router.GET("/cmp/v1/users", EnsureSuperAdmin(rawStoreAccess(service.Users)))
	router.POST("/cmp/v1/users", EnsureSuperAdmin(rawStoreAccess(service.NewUser)))

	router.GET("/cmp/v1/users/:id", EnsureSuperAdmin(rawStoreAccess(service.UserID)))
	router.DELETE("/cmp/v1/users/:id", EnsureSuperAdmin(rawStoreAccess(service.RemoveUser)))
	router.PATCH("/cmp/v1/users/:id", EnsureSuperAdmin(rawStoreAccess(service.UpdateUser)))

	// Dashboards
	router.GET("/cmp/v1/dashboards", EnsureViewer(service.Dashboards))
	router.POST("/cmp/v1/dashboards", EnsureEditor(service.NewDashboard))

	router.GET("/cmp/v1/dashboards/:id", EnsureViewer(service.DashboardID))
	router.DELETE("/cmp/v1/dashboards/:id", EnsureEditor(service.RemoveDashboard))
	router.PUT("/cmp/v1/dashboards/:id", EnsureEditor(service.ReplaceDashboard))
	router.PATCH("/cmp/v1/dashboards/:id", EnsureEditor(service.UpdateDashboard))

	// Dashboard Cells
	router.GET("/cmp/v1/dashboards/:id/cells", EnsureViewer(service.DashboardCells))
	router.POST("/cmp/v1/dashboards/:id/cells", EnsureEditor(service.NewDashboardCell))

	router.GET("/cmp/v1/dashboards/:id/cells/:cid", EnsureViewer(service.DashboardCellID))
	router.DELETE("/cmp/v1/dashboards/:id/cells/:cid", EnsureEditor(service.RemoveDashboardCell))
	router.PUT("/cmp/v1/dashboards/:id/cells/:cid", EnsureEditor(service.ReplaceDashboardCell))

	// Dashboard Templates
	router.GET("/cmp/v1/dashboards/:id/templates", EnsureViewer(service.Templates))
	router.POST("/cmp/v1/dashboards/:id/templates", EnsureEditor(service.NewTemplate))

	router.GET("/cmp/v1/dashboards/:id/templates/:tid", EnsureViewer(service.TemplateID))
	router.DELETE("/cmp/v1/dashboards/:id/templates/:tid", EnsureEditor(service.RemoveTemplate))
	router.PUT("/cmp/v1/dashboards/:id/templates/:tid", EnsureEditor(service.ReplaceTemplate))

	// Databases
	router.GET("/cmp/v1/sources/:id/dbs", EnsureViewer(service.GetDatabases))
	router.POST("/cmp/v1/sources/:id/dbs", EnsureEditor(service.NewDatabase))

	router.DELETE("/cmp/v1/sources/:id/dbs/:db", EnsureEditor(service.DropDatabase))

	// Retention Policies
	router.GET("/cmp/v1/sources/:id/dbs/:db/rps", EnsureViewer(service.RetentionPolicies))
	router.POST("/cmp/v1/sources/:id/dbs/:db/rps", EnsureEditor(service.NewRetentionPolicy))

	router.PUT("/cmp/v1/sources/:id/dbs/:db/rps/:rp", EnsureEditor(service.UpdateRetentionPolicy))
	router.DELETE("/cmp/v1/sources/:id/dbs/:db/rps/:rp", EnsureEditor(service.DropRetentionPolicy))

	// Measurements
	router.GET("/cmp/v1/sources/:id/dbs/:db/measurements", EnsureViewer(service.Measurements))

	// Global application config for CMP
	router.GET("/cmp/v1/config", EnsureSuperAdmin(service.Config))
	router.GET("/cmp/v1/config/auth", EnsureSuperAdmin(service.AuthConfig))
	router.PUT("/cmp/v1/config/auth", EnsureSuperAdmin(service.ReplaceAuthConfig))

	// Organization config settings for CMP
	router.GET("/cmp/v1/org_config", EnsureViewer(service.OrganizationConfig))
	router.GET("/cmp/v1/org_config/logviewer", EnsureViewer(service.OrganizationLogViewerConfig))
	router.PUT("/cmp/v1/org_config/logviewer", EnsureEditor(service.ReplaceOrganizationLogViewerConfig))

	router.GET("/cmp/v1/env", EnsureViewer(service.Environment))

	/// V2 Cells
	router.GET("/cmp/v2/cells", EnsureViewer(service.CellsV2))
	router.POST("/cmp/v2/cells", EnsureEditor(service.NewCellV2))

	router.GET("/cmp/v2/cells/:id", EnsureViewer(service.CellIDV2))
	router.DELETE("/cmp/v2/cells/:id", EnsureEditor(service.RemoveCellV2))
	router.PATCH("/cmp/v2/cells/:id", EnsureEditor(service.UpdateCellV2))

	// V2 Dashboards
	router.GET("/cmp/v2/dashboards", EnsureViewer(service.DashboardsV2))
	router.POST("/cmp/v2/dashboards", EnsureEditor(service.NewDashboardV2))

	router.GET("/cmp/v2/dashboards/:id", EnsureViewer(service.DashboardIDV2))
	router.DELETE("/cmp/v2/dashboards/:id", EnsureEditor(service.RemoveDashboardV2))
	router.PATCH("/cmp/v2/dashboards/:id", EnsureEditor(service.UpdateDashboardV2))

	allRoutes := &AllRoutes{
		Logger:      opts.Logger,
		StatusFeed:  opts.StatusFeedURL,
		CustomLinks: opts.CustomLinks,
	}

	getPrincipal := func(r *http.Request) oauth2.Principal {
		p, _ := HasAuthorizedToken(opts.Auth, r)
		return p
	}
	allRoutes.GetPrincipal = getPrincipal
	router.Handler("GET", "/cmp/v1/", allRoutes)

	var out http.Handler

	/* Authentication */
	if opts.UseAuth {
		// Encapsulate the router with OAuth2
		var auth http.Handler
		auth, allRoutes.AuthRoutes = AuthAPI(opts, router)
		allRoutes.LogoutLink = path.Join(opts.Basepath, "/oauth/logout")

		// Create middleware that redirects to the appropriate provider logout
		router.GET("/oauth/logout", Logout("/", opts.Basepath, allRoutes.AuthRoutes))
		out = Logger(opts.Logger, FlushingHandler(auth))
	} else {
		out = Logger(opts.Logger, FlushingHandler(router))
	}

	return out
}

// AuthAPI adds the OAuth routes if auth is enabled.
func AuthAPI(opts MuxOpts, router cmp.Router) (http.Handler, AuthRoutes) {
	routes := AuthRoutes{}
	for _, pf := range opts.ProviderFuncs {
		pf(func(p oauth2.Provider, m oauth2.Mux) {
			urlName := PathEscape(strings.ToLower(p.Name()))

			loginPath := path.Join("/oauth", urlName, "login")
			logoutPath := path.Join("/oauth", urlName, "logout")
			callbackPath := path.Join("/oauth", urlName, "callback")

			router.Handler("GET", loginPath, m.Login())
			router.Handler("GET", logoutPath, m.Logout())
			router.Handler("GET", callbackPath, m.Callback())
			routes = append(routes, AuthRoute{
				Name:  p.Name(),
				Label: strings.Title(p.Name()),
				// AuthRoutes are content served to the page. When Basepath is set, it
				// says that all content served to the page will be prefixed with the
				// basepath. Since these routes are consumed by JS, it will need the
				// basepath set to traverse a proxy correctly
				Login:    path.Join(opts.Basepath, loginPath),
				Logout:   path.Join(opts.Basepath, logoutPath),
				Callback: path.Join(opts.Basepath, callbackPath),
			})
		})
	}

	rootPath := path.Join(opts.Basepath, "/cmp/v1")
	logoutPath := path.Join(opts.Basepath, "/oauth/logout")

	tokenMiddleware := AuthorizedToken(opts.Auth, opts.Logger, router)
	// Wrap the API with token validation middleware.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cleanPath := path.Clean(r.URL.Path) // compare ignoring path garbage, trailing slashes, etc.
		if (strings.HasPrefix(cleanPath, rootPath) && len(cleanPath) > len(rootPath)) || cleanPath == logoutPath {
			tokenMiddleware.ServeHTTP(w, r)
			return
		}
		router.ServeHTTP(w, r)
	}), routes
}

func encodeJSON(w http.ResponseWriter, status int, v interface{}, logger cmp.Logger) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		unknownErrorWithMessage(w, err, logger)
	}
}

// Error writes an JSON message
func Error(w http.ResponseWriter, code int, msg string, logger cmp.Logger) {
	e := ErrorMessage{
		Code:    code,
		Message: msg,
	}
	b, err := json.Marshal(e)
	if err != nil {
		code = http.StatusInternalServerError
		b = []byte(`{"code": 500, "message":"server_error"}`)
	}

	logger.
		WithField("component", "server").
		WithField("http_status ", code).
		Error("Error message ", msg)
	w.Header().Set("Content-Type", JSONType)
	w.WriteHeader(code)
	_, _ = w.Write(b)
}

func invalidData(w http.ResponseWriter, err error, logger cmp.Logger) {
	Error(w, http.StatusUnprocessableEntity, fmt.Sprintf("%v", err), logger)
}

func invalidJSON(w http.ResponseWriter, logger cmp.Logger) {
	Error(w, http.StatusBadRequest, "Unparsable JSON", logger)
}

func unknownErrorWithMessage(w http.ResponseWriter, err error, logger cmp.Logger) {
	Error(w, http.StatusInternalServerError, fmt.Sprintf("Unknown error: %v", err), logger)
}

func notFound(w http.ResponseWriter, id interface{}, logger cmp.Logger) {
	Error(w, http.StatusNotFound, fmt.Sprintf("ID %v not found", id), logger)
}

func paramID(key string, r *http.Request) (int, error) {
	ctx := r.Context()
	param := httprouter.GetParamFromContext(ctx, key)
	id, err := strconv.Atoi(param)
	if err != nil {
		return -1, fmt.Errorf("Error converting ID %s", param)
	}
	return id, nil
}

func paramInt64(key string, r *http.Request) (int64, error) {
	ctx := r.Context()
	param := httprouter.GetParamFromContext(ctx, key)
	v, err := strconv.ParseInt(param, 10, 64)
	if err != nil {
		return -1, fmt.Errorf("Error converting parameter %s", param)
	}
	return v, nil
}

func paramStr(key string, r *http.Request) (string, error) {
	ctx := r.Context()
	param := httprouter.GetParamFromContext(ctx, key)
	return param, nil
}