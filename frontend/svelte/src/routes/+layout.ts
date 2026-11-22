// The current cockpit is client-mounted too. This entry serves static assets,
// not a second SSR process. Auth and host operations remain in the existing API.
export const ssr = false;
