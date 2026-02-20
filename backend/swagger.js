import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "ShiftLedger API",
      version: "1.0.0",
      description: "API для автоматического составления расписания детской студии",
    },
    servers: [{ url: "http://localhost:3000" }],
    components: {
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ["./backend/routes/*.js", "./backend/server.js"],
};

export const specs = swaggerJsdoc(options);
