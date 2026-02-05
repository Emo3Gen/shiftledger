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

    // 🔑 КЛЮЧЕВОЕ МЕСТО
    // Worker принимает /api/*
    // Backend работает без /api
    const pathname = url.pathname.replace(/^\/api/, "") || "/";

    const targetUrl = backend + pathname;

    return fetch(targetUrl, request);
  },
};

