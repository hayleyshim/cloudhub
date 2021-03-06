package server

import (
	"fmt"

	cloudhub "github.com/snetsystems/cloudhub/backend"
	"github.com/snetsystems/cloudhub/backend/influx"
)

// ToQueryConfig converts InfluxQL into queryconfigs
// If influxql cannot be represented by a full query config, then, the
// query config's raw text is set to the query.
func ToQueryConfig(query string) cloudhub.QueryConfig {
	qc, err := influx.Convert(query)
	if err == nil {
		return qc
	}
	return cloudhub.QueryConfig{
		RawText: &query,
		Fields:  []cloudhub.Field{},
		GroupBy: cloudhub.GroupBy{
			Tags: []string{},
		},
		Tags: make(map[string][]string, 0),
	}
}

var validFieldTypes = map[string]bool{
	"func":     true,
	"field":    true,
	"integer":  true,
	"number":   true,
	"regex":    true,
	"wildcard": true,
}

// ValidateQueryConfig checks any query config input
func ValidateQueryConfig(q *cloudhub.QueryConfig) error {
	for _, fld := range q.Fields {
		invalid := fmt.Errorf(`invalid field type "%s" ; expect func, field, integer, number, regex, wildcard`, fld.Type)
		if !validFieldTypes[fld.Type] {
			return invalid
		}
		for _, arg := range fld.Args {
			if !validFieldTypes[arg.Type] {
				return invalid
			}
		}
	}
	return nil
}
