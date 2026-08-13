package vault

import (
	"fmt"

	"github.com/hashicorp/vault/api"
)

// Client wraps the standard HashiCorp Vault client
type Client struct {
	*api.Client
}

// NewClient initializes a connection to the Vault cluster
func NewClient(address, token string) (*Client, error) {
	config := api.DefaultConfig()
	config.Address = address

	client, err := api.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("unable to initialize vault client: %w", err)
	}

	client.SetToken(token)
	return &Client{Client: client}, nil
}
