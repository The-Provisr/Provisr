package pricing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxProviderResponse = 256 << 20

type awsProvider struct {
	client       *http.Client
	accessKey    string
	secretKey    string
	sessionToken string
}

func (p awsProvider) lookup(ctx context.Context, request LookupRequest) (providerOffer, error) {
	if request.Mode == "on_demand" {
		if p.accessKey == "" || p.secretKey == "" {
			return providerOffer{}, ErrUnavailable
		}
		return p.queryAPI(ctx, request)
	}
	return p.bulkAPI(ctx, request)
}

func (p awsProvider) queryAPI(ctx context.Context, request LookupRequest) (providerOffer, error) {
	type filter struct {
		Field string `json:"Field"`
		Value string `json:"Value"`
		Type  string `json:"Type"`
	}
	filters := []filter{{Field: "regionCode", Value: request.Region, Type: "TERM_MATCH"}}
	for key, value := range request.Filters {
		filters = append(filters, filter{Field: key, Value: value, Type: "TERM_MATCH"})
	}
	if request.Tier != "" {
		filters = append(filters, filter{Field: "instanceType", Value: request.Tier, Type: "TERM_MATCH"})
	}
	body, err := json.Marshal(map[string]any{
		"ServiceCode": request.Service, "FormatVersion": "aws_v1", "MaxResults": 100,
		"Filters": filters,
	})
	if err != nil {
		return providerOffer{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.pricing.us-east-1.amazonaws.com/", bytes.NewReader(body))
	if err != nil {
		return providerOffer{}, err
	}
	date := time.Now().UTC().Format("20060102T150405Z")
	day := date[:8]
	req.Header.Set("Content-Type", "application/x-amz-json-1.1")
	req.Header.Set("X-Amz-Date", date)
	req.Header.Set("X-Amz-Target", "AWSPriceListService.GetProducts")
	if p.sessionToken != "" {
		req.Header.Set("X-Amz-Security-Token", p.sessionToken)
	}
	signAWSRequest(req, body, p.accessKey, p.secretKey, p.sessionToken, day)
	response, err := p.client.Do(req)
	if err != nil {
		return providerOffer{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return providerOffer{}, ErrUnavailable
	}
	var result struct {
		PriceList []json.RawMessage `json:"PriceList"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxProviderResponse)).Decode(&result); err != nil {
		return providerOffer{}, err
	}
	for _, raw := range result.PriceList {
		var offer awsBulkOffer
		if len(raw) > 0 && raw[0] == '"' {
			var encoded string
			if json.Unmarshal(raw, &encoded) != nil {
				continue
			}
			raw = []byte(encoded)
		}
		if json.Unmarshal(raw, &offer) != nil {
			continue
		}
		if matchesAttributes(offer.Product.Attributes, request.Filters) && matchesTier(offer.Product.Attributes, request.Tier) {
			if normalized, ok := awsPrice(offer, request.Currency); ok {
				return normalized, nil
			}
		}
	}
	return providerOffer{}, ErrNotFound
}

func signAWSRequest(req *http.Request, body []byte, access, secret, token, day string) {
	date := req.Header.Get("X-Amz-Date")
	payloadHash := sha256.Sum256(body)
	canonicalHeaders := "content-type:" + req.Header.Get("Content-Type") + "\n" +
		"host:" + req.URL.Host + "\n" + "x-amz-date:" + date + "\n"
	signedHeaders := "content-type;host;x-amz-date"
	if token != "" {
		canonicalHeaders += "x-amz-security-token:" + token + "\n"
		signedHeaders += ";x-amz-security-token"
	}
	canonicalHeaders += "x-amz-target:" + req.Header.Get("X-Amz-Target") + "\n"
	signedHeaders += ";x-amz-target"
	canonicalRequest := strings.Join([]string{
		req.Method, req.URL.EscapedPath(), "", canonicalHeaders, signedHeaders,
		hex.EncodeToString(payloadHash[:]),
	}, "\n")
	canonicalHash := sha256.Sum256([]byte(canonicalRequest))
	scope := day + "/us-east-1/pricing/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + date + "\n" + scope + "\n" + hex.EncodeToString(canonicalHash[:])
	kDate := hmacSHA256([]byte("AWS4"+secret), day)
	kRegion := hmacSHA256(kDate, "us-east-1")
	kService := hmacSHA256(kRegion, "pricing")
	kSigning := hmacSHA256(kService, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(kSigning, stringToSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+access+"/"+scope+
		", SignedHeaders="+signedHeaders+", Signature="+signature)
}

func hmacSHA256(key []byte, value string) []byte {
	h := hmac.New(sha256.New, key)
	_, _ = h.Write([]byte(value))
	return h.Sum(nil)
}

func (p awsProvider) bulkAPI(ctx context.Context, request LookupRequest) (providerOffer, error) {
	if !safeSegment(request.Service) || !safeSegment(request.Region) {
		return providerOffer{}, ErrNotFound
	}
	endpoint := "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/" +
		request.Service + "/current/" + request.Region + "/index.json"
	var offer awsBulkFile
	if err := getJSON(ctx, p.client, endpoint, &offer); err != nil {
		return providerOffer{}, err
	}
	for sku, product := range offer.Products {
		if !matchesAttributes(product.Attributes, request.Filters) || !matchesTier(product.Attributes, request.Tier) {
			continue
		}
		terms := offer.Terms.OnDemand[sku]
		for _, term := range terms {
			for _, dimension := range term.PriceDimensions {
				if request.Unit != "" && !strings.EqualFold(request.Unit, dimension.Unit) {
					continue
				}
				if price, ok := parsePrice(dimension.PricePerUnit[request.Currency]); ok {
					return providerOffer{
						Unit: dimension.Unit, PricePerUnit: price, Currency: request.Currency,
						EffectiveDate: parseDate(dimension.EffectiveDate),
						Tier:          firstNonEmpty(product.Attributes["instanceType"], product.Attributes["volumeType"], request.Tier),
					}, nil
				}
			}
		}
	}
	return providerOffer{}, ErrNotFound
}

type awsBulkFile struct {
	Products map[string]struct {
		Attributes map[string]string `json:"attributes"`
	} `json:"products"`
	Terms struct {
		OnDemand map[string]map[string]struct {
			PriceDimensions map[string]struct {
				Unit          string            `json:"unit"`
				EffectiveDate string            `json:"effectiveDate"`
				PricePerUnit  map[string]string `json:"pricePerUnit"`
			} `json:"priceDimensions"`
		} `json:"OnDemand"`
	} `json:"terms"`
}

type awsBulkOffer struct {
	Product struct {
		Attributes map[string]string `json:"attributes"`
	} `json:"product"`
	Terms struct {
		OnDemand map[string]map[string]struct {
			PriceDimensions map[string]struct {
				Unit          string            `json:"unit"`
				EffectiveDate string            `json:"effectiveDate"`
				PricePerUnit  map[string]string `json:"pricePerUnit"`
			} `json:"priceDimensions"`
		} `json:"OnDemand"`
	} `json:"terms"`
}

func awsPrice(offer awsBulkOffer, currency string) (providerOffer, bool) {
	for _, byCode := range offer.Terms.OnDemand {
		for _, term := range byCode {
			for _, dimension := range term.PriceDimensions {
				if price, ok := parsePrice(dimension.PricePerUnit[currency]); ok {
					return providerOffer{Unit: dimension.Unit, PricePerUnit: price, Currency: currency,
						EffectiveDate: parseDate(dimension.EffectiveDate),
						Tier:          firstNonEmpty(offer.Product.Attributes["instanceType"], offer.Product.Attributes["volumeType"])}, true
				}
			}
		}
	}
	return providerOffer{}, false
}

type azureProvider struct{ client *http.Client }

type azurePriceItem struct {
	RetailPrice float64 `json:"retailPrice"`
	UnitPrice   float64 `json:"unitPrice"`
	Currency    string  `json:"currencyCode"`
	SKU         string  `json:"skuName"`
	Unit        string  `json:"unitOfMeasure"`
	Effective   string  `json:"effectiveStartDate"`
}

type azurePriceResponse struct {
	Items        []azurePriceItem `json:"Items"`
	NextPageLink string           `json:"NextPageLink"`
}

func (p azureProvider) lookup(ctx context.Context, request LookupRequest) (providerOffer, error) {
	clauses := []string{"serviceName eq '" + odataEscape(request.Service) + "'", "armRegionName eq '" + odataEscape(request.Region) + "'"}
	filters := make(map[string]string, len(request.Filters)+2)
	for key, value := range request.Filters {
		filters[key] = value
	}
	if request.Tier != "" {
		filters["skuName"] = request.Tier
	}
	if request.Unit != "" {
		filters["unitOfMeasure"] = request.Unit
	}
	keys := make([]string, 0, len(filters))
	for key := range filters {
		if key != "serviceName" && key != "armRegionName" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !regexpIdentifier(key) {
			return providerOffer{}, fmt.Errorf("invalid Azure filter")
		}
		clauses = append(clauses, key+" eq '"+odataEscape(filters[key])+"'")
	}
	query := url.Values{}
	query.Set("api-version", "2023-01-01-preview")
	query.Set("currencyCode", "'"+request.Currency+"'")
	query.Set("$filter", strings.Join(clauses, " and "))
	endpoint := "https://prices.azure.com/api/retail/prices?" + query.Encode()
	for page := 0; page < 5; page++ {
		var response azurePriceResponse
		if err := getJSON(ctx, p.client, endpoint, &response); err != nil {
			return providerOffer{}, err
		}
		if len(response.Items) > 0 {
			item := response.Items[0]
			price := item.RetailPrice
			if item.UnitPrice > 0 {
				price = item.UnitPrice
			}
			return providerOffer{Unit: item.Unit, PricePerUnit: price, Currency: item.Currency,
				EffectiveDate: parseDate(item.Effective), Tier: item.SKU}, nil
		}
		if response.NextPageLink == "" {
			break
		}
		next, err := url.Parse(response.NextPageLink)
		if err != nil || next.Scheme != "https" || next.Host != "prices.azure.com" {
			return providerOffer{}, ErrUnavailable
		}
		endpoint = next.String()
	}
	return providerOffer{}, ErrNotFound
}

type gcpProvider struct {
	client *http.Client
	apiKey string
}

type gcpUnitPrice struct {
	Currency string `json:"currencyCode"`
	Units    string `json:"units"`
	Nanos    int64  `json:"nanos"`
}

type gcpTieredRate struct {
	UnitPrice gcpUnitPrice `json:"unitPrice"`
}

type gcpPricingInfo struct {
	EffectiveTime string `json:"effectiveTime"`
	Expression    struct {
		UsageUnit   string          `json:"usageUnit"`
		TieredRates []gcpTieredRate `json:"tieredRates"`
	} `json:"pricingExpression"`
}

type gcpSKU struct {
	Description string   `json:"description"`
	Regions     []string `json:"serviceRegions"`
	Category    struct {
		ResourceFamily string `json:"resourceFamily"`
		ResourceGroup  string `json:"resourceGroup"`
		UsageType      string `json:"usageType"`
	} `json:"category"`
	GeoTaxonomy struct {
		Type string `json:"type"`
	} `json:"geoTaxonomy"`
	PricingInfo []gcpPricingInfo `json:"pricingInfo"`
}

func (p gcpProvider) lookup(ctx context.Context, request LookupRequest) (providerOffer, error) {
	if p.apiKey == "" {
		return providerOffer{}, ErrUnavailable
	}
	if !safeSegment(request.Service) {
		return providerOffer{}, ErrNotFound
	}
	query := url.Values{}
	query.Set("key", p.apiKey)
	query.Set("pageSize", "5000")
	query.Set("currencyCode", request.Currency)
	base := "https://cloudbilling.googleapis.com/v1/services/" + url.PathEscape(request.Service) + "/skus"
	for page := 0; page < 10; page++ {
		var response struct {
			SKUs          []gcpSKU `json:"skus"`
			NextPageToken string   `json:"nextPageToken"`
		}
		if err := getJSON(ctx, p.client, base+"?"+query.Encode(), &response); err != nil {
			return providerOffer{}, err
		}
		for _, sku := range response.SKUs {
			if (!containsFold(sku.Regions, request.Region) && !strings.EqualFold(sku.GeoTaxonomy.Type, "GLOBAL")) ||
				(request.Tier != "" && !strings.Contains(strings.ToLower(sku.Description), strings.ToLower(request.Tier))) ||
				!matchesGCPFilters(sku, request.Filters) {
				continue
			}
			info := latestGCPPricingInfo(sku.PricingInfo)
			if info == nil || (request.Unit != "" && !strings.EqualFold(request.Unit, info.Expression.UsageUnit)) {
				continue
			}
			unitPrice := info.Expression.TieredRates[0].UnitPrice
			units, _ := strconv.ParseFloat(unitPrice.Units, 64)
			price := units + float64(unitPrice.Nanos)/1e9
			if unitPrice.Currency != request.Currency {
				continue
			}
			return providerOffer{Unit: info.Expression.UsageUnit, PricePerUnit: price, Currency: unitPrice.Currency,
				EffectiveDate: parseDate(info.EffectiveTime), Tier: sku.Description}, nil
		}
		if response.NextPageToken == "" {
			break
		}
		query.Set("pageToken", response.NextPageToken)
	}
	return providerOffer{}, ErrNotFound
}

func matchesGCPFilters(sku gcpSKU, filters map[string]string) bool {
	for key, expected := range filters {
		var actual string
		switch key {
		case "resourceFamily":
			actual = sku.Category.ResourceFamily
		case "resourceGroup":
			actual = sku.Category.ResourceGroup
		case "usageType":
			actual = sku.Category.UsageType
		case "description":
			if !strings.Contains(strings.ToLower(sku.Description), strings.ToLower(expected)) {
				return false
			}
			continue
		default:
			return false
		}
		if !strings.EqualFold(actual, expected) {
			return false
		}
	}
	return true
}

func latestGCPPricingInfo(values []gcpPricingInfo) *gcpPricingInfo {
	var latest *gcpPricingInfo
	for i := range values {
		if len(values[i].Expression.TieredRates) == 0 {
			continue
		}
		if latest == nil || parseDate(values[i].EffectiveTime).After(parseDate(latest.EffectiveTime)) {
			latest = &values[i]
		}
	}
	return latest
}

func getJSON(ctx context.Context, client *http.Client, endpoint string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ErrUnavailable
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxProviderResponse))
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return nil
}

func matchesAttributes(attributes, filters map[string]string) bool {
	for key, expected := range filters {
		if !strings.EqualFold(attributes[key], expected) {
			return false
		}
	}
	return true
}

func matchesTier(attributes map[string]string, tier string) bool {
	if tier == "" {
		return true
	}
	for _, key := range []string{"instanceType", "volumeType", "databaseEdition", "databaseEngine", "productFamily"} {
		if strings.EqualFold(attributes[key], tier) {
			return true
		}
	}
	return false
}

func parsePrice(value string) (float64, bool) {
	price, err := strconv.ParseFloat(value, 64)
	return price, err == nil
}

func parseDate(value string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}

func safeSegment(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func regexpIdentifier(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}

func odataEscape(value string) string { return strings.ReplaceAll(value, "'", "''") }

func containsFold(values []string, needle string) bool {
	for _, value := range values {
		if strings.EqualFold(value, needle) {
			return true
		}
	}
	return false
}
