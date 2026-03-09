export default {
  async fetch(request, env) {
    const backend = env.DEV_BACKEND_URL || env.PROD_BACKEND_URL;

    if (!backend) {
      return new Response(
        "Neither DEV_BACKEND_URL nor PROD_BACKEND_URL is configured",
        { status: 500 }
      );
    }

    const url = new URL(request.url);
    const targetUrl = backend + url.pathname + url.search;

    return fetch(targetUrl, request);
  },
};

