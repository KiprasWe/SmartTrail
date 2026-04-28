import type * as types from './types';
import type { ConfigOptions, FetchResponse } from 'api/dist/core';
import Oas from 'oas';
import APICore from 'api/dist/core';
declare class SDK {
    spec: Oas;
    core: APICore;
    constructor();
    /**
     * Optionally configure various options that the SDK allows.
     *
     * @param config Object of supported SDK options and toggles.
     * @param config.timeout Override the default `fetch` request timeout of 30 seconds. This number
     * should be represented in milliseconds.
     */
    config(config: ConfigOptions): void;
    /**
     * If the API you're using requires authentication you can supply the required credentials
     * through this method and the library will magically determine how they should be used
     * within your API request.
     *
     * With the exception of OpenID and MutualTLS, it supports all forms of authentication
     * supported by the OpenAPI specification.
     *
     * @example <caption>HTTP Basic auth</caption>
     * sdk.auth('username', 'password');
     *
     * @example <caption>Bearer tokens (HTTP or OAuth 2)</caption>
     * sdk.auth('myBearerToken');
     *
     * @example <caption>API Keys</caption>
     * sdk.auth('myApiKey');
     *
     * @see {@link https://spec.openapis.org/oas/v3.0.3#fixed-fields-22}
     * @see {@link https://spec.openapis.org/oas/v3.1.0#fixed-fields-22}
     * @param values Your auth credentials for the API; can specify up to two strings or numbers.
     */
    auth(...values: string[] | number[]): this;
    /**
     * If the API you're using offers alternate server URLs, and server variables, you can tell
     * the SDK which one to use with this method. To use it you can supply either one of the
     * server URLs that are contained within the OpenAPI definition (along with any server
     * variables), or you can pass it a fully qualified URL to use (that may or may not exist
     * within the OpenAPI definition).
     *
     * @example <caption>Server URL with server variables</caption>
     * sdk.server('https://{region}.api.example.com/{basePath}', {
     *   name: 'eu',
     *   basePath: 'v14',
     * });
     *
     * @example <caption>Fully qualified server URL</caption>
     * sdk.server('https://eu.api.example.com/v14');
     *
     * @param url Server URL
     * @param variables An object of variables to replace into the server URL.
     */
    server(url: string, variables?: {}): void;
    /**
     * Returns a list of top places, geos, and/or searches partially matching the provided
     * keyword and location inputs.
     *
     * @summary Autocomplete
     */
    autocomplete(metadata: types.AutocompleteMetadataParam): Promise<FetchResponse<200, types.AutocompleteResponse200>>;
    /**
     * Search for places in the FSQ Places database using a location and querying by name,
     * category name, telephone number, taste label, or chain name. For example, search for
     * "coffee" to get back a list of recommended coffee shops.
     *
     * You may pass a location with your request by using one of the following options. If none
     * of the following options are passed, Place Search defaults to geolocation using ip
     * biasing with the optional radius parameter.
     *
     * <ul><li>ll & radius (circular boundary)</li><li>near (geocodable locality)</li><li>ne &
     * sw (rectangular boundary)</li></ul>
     *
     * @summary Place Search
     */
    placeSearch(metadata: types.PlaceSearchMetadataParam): Promise<FetchResponse<200, types.PlaceSearchResponse200>>;
    /**
     * Ask is a natural language place search that returns a list of places matching a
     * natural-language question. Provide `query` with what the user wants (e.g., "best
     * cocktail lounge"). Location is first attempted to be parsed from the query, but you may
     * optionally use either `ll` (lat,lng) or `location` (geocodable string) as fallbacks to
     * set the search area. You may also pass `context` to describe preferences (e.g.,
     * "traveling with kids, need outdoor seating").
     *
     * **Note: The Ask Endpoint is only available upon request. If you are interested in using
     * this endpoint, please [contact
     * us](https://support.foursquare.com/hc/en-us/requests/new?ticket_form_id=13089705025180&tf_subject=Ask%20Access&tf_13089887414684=ask_enterprise_ga_dp)
     * to request access.**
     *
     * @summary Ask
     */
    ask(metadata: types.AskMetadataParam): Promise<FetchResponse<200, types.AskResponse200>>;
    /**
     * Retrieve comprehensive information and metadata for a FSQ Place using the fsq_place_id.
     *
     * @summary Get Place Details
     */
    placeDetails(metadata: types.PlaceDetailsMetadataParam): Promise<FetchResponse<200, types.PlaceDetailsResponse200>>;
    /**
     * Retrieve tips for a FSQ Place using the fsq_place_id.
     *
     * @summary Get Place Tips
     */
    placeTips(metadata: types.PlaceTipsMetadataParam): Promise<FetchResponse<200, types.PlaceTipsResponse200>>;
    /**
     * Retrieve photos for a FSQ Place using the fsq_place_id.
     *
     * To retrieve photos from a Photos response, learn [how to assemble photo
     * URLs](https://docs.foursquare.com/reference/photos-guide#assembling-a-photo-url).
     *
     * @summary Get Place Photos
     */
    placePhotos(metadata: types.PlacePhotosMetadataParam): Promise<FetchResponse<200, types.PlacePhotosResponse200>>;
    /**
     * Suggest the merge of two or more places.
     *
     * @summary Merge Places
     */
    suggestMerge(metadata: types.SuggestMergeMetadataParam): Promise<FetchResponse<200, types.SuggestMergeResponse200>>;
    /**
     * Suggest edits to an existing Place’s information such as address, phone number, and
     * hours of operation via its `fsq_place_id`. Providing values for the parameters below
     * constitute the proposed edit.
     *
     * @summary Edit a Place
     */
    placeSuggestEdit(metadata: types.PlaceSuggestEditMetadataParam): Promise<FetchResponse<200, types.PlaceSuggestEditResponse200>>;
    /**
     * Flag an entire place for removal for reasons such as closed, doesn't exist,
     * inappropriate, or private.
     *
     * @summary Remove a Place
     */
    placeSuggestRemove(metadata: types.PlaceSuggestRemoveMetadataParam): Promise<FetchResponse<200, types.PlaceSuggestRemoveResponse200>>;
    /**
     * Flag a field(s) on a Place as incorrect. Does not require you to provide the correct
     * value.
     *
     * @summary Flag a Place
     */
    placeFlag(metadata: types.PlaceFlagMetadataParam): Promise<FetchResponse<200, types.PlaceFlagResponse200>>;
    /**
     * Add a new place that does not currently exist. We will first attempt to find a match in
     * our database. If we do not find a match, we will create a new suggested place.
     *
     * @summary Suggest a New Place
     */
    placesSuggestPlace(metadata: types.PlacesSuggestPlaceMetadataParam): Promise<FetchResponse<200, types.PlacesSuggestPlaceResponse200>>;
    /**
     * Monitor the status of the places edits provided by your users or service keys.
     *
     * @summary Get Suggestion Status
     */
    placeSuggestStatus(metadata: types.PlaceSuggestStatusMetadataParam): Promise<FetchResponse<200, types.PlaceSuggestStatusResponse200>>;
    /**
     * Get a list of the top places that need review for a given location.
     *
     * @summary Get Places With Pending Suggested Edits
     */
    placeTopVenueWoes(metadata: types.PlaceTopVenueWoesMetadataParam): Promise<FetchResponse<200, types.PlaceTopVenueWoesResponse200>>;
    /**
     * Utilize Foursquare's Snap to Place technology to detect where your user's device is and
     * what is around them.
     *
     * This endpoint will intentionally return lower quality results not found in Place Search.
     * It is not intended to replace Place Search as the primary way to search for top,
     * recommended POIs.
     *
     * @summary Find Geotagging Candidates
     */
    geotaggingCandidates(metadata: types.GeotaggingCandidatesMetadataParam): Promise<FetchResponse<200, types.GeotaggingCandidatesResponse200>>;
    /**
     * Report the selection of a place as the result of a Geotagging Candidates request.
     *
     * @summary Confirm Geotagging Candidate Selection
     */
    geotaggingConfirm(metadata: types.GeotaggingConfirmMetadataParam): Promise<FetchResponse<200, types.GeotaggingConfirmResponse200>>;
    /**
     * Check the status of previously submitted Places API offline jobs. Jobs and their
     * statuses are retained for 90 days after initialization.
     *
     * For more details on how to use the Offline Jobs Endpoints, please refer to the
     * [onboarding
     * guide](https://docs.foursquare.com/fsq-developers-places/reference/offline-job-onboarding-guide).
     *
     * @summary Get Offline Jobs Status
     */
    offlineJobsStatus(metadata: types.OfflineJobsStatusMetadataParam): Promise<FetchResponse<200, types.OfflineJobsStatusResponse200>>;
    /**
     * Execute a previously initialized offline job. Note you may not execute jobs that are
     * already running or have completed, but you may use this endpoint to re-execute failed
     * jobs.
     *
     * For more details on how to use the Offline Jobs Endpoints, please refer to the
     * [onboarding
     * guide](https://docs.foursquare.com/fsq-developers-places/reference/offline-job-onboarding-guide).
     *
     * @summary Execute an Offline Job
     */
    offlineJobsExecute(metadata: types.OfflineJobsExecuteMetadataParam): Promise<FetchResponse<200, types.OfflineJobsExecuteResponse200>>;
    /**
     * Initialize an offline job and generate temporary AWS credentials for uploading and
     * reading data.
     *
     * For more details on how to use the Offline Jobs Endpoints, please refer to the
     * [onboarding
     * guide](https://docs.foursquare.com/fsq-developers-places/reference/offline-job-onboarding-guide).
     *
     * @summary Initialize an Offline Job
     */
    offlineJobsInitialize(metadata: types.OfflineJobsInitializeMetadataParam): Promise<FetchResponse<200, types.OfflineJobsInitializeResponse200>>;
    /**
     * Refreshes temporary AWS credentials for an existing offline job. This is useful if your
     * original credentials have expired.
     *
     * For more details on how to use the Offline Jobs Endpoints, please refer to the
     * [onboarding
     * guide](https://docs.foursquare.com/fsq-developers-places/reference/offline-job-onboarding-guide).
     *
     * @summary Refresh Offline Job Credentials
     */
    offlineJobsCredentialsRefresh(metadata: types.OfflineJobsCredentialsRefreshMetadataParam): Promise<FetchResponse<200, types.OfflineJobsCredentialsRefreshResponse200>>;
    /**
     * Return the Foursquare record of a POI (via fsq_place_id) given a name and location.
     *
     * @summary Place Match
     */
    placeMatch(metadata: types.PlaceMatchMetadataParam): Promise<FetchResponse<200, types.PlaceMatchResponse200>>;
}
declare const createSDK: SDK;
export default createSDK;
