package mocks

// NewResponse returns a mocked cloudhub.Response
func NewResponse(res string, err error) *Response {
	return &Response{
		res: res,
		err: err,
	}
}

// Response is a mocked cloudhub.Response
type Response struct {
	res string
	err error
}

// MarshalJSON returns the res and err as the fake response.
func (r *Response) MarshalJSON() ([]byte, error) {
	return []byte(r.res), r.err
}
