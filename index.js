import { createPublicKey, verify as verifySignature } from "node:crypto";
import http from "node:http";
import path from "node:path";

import express from "express";
import { Server } from "socket.io";

import { kafkaClient } from "./kafka-client.js";

const AUTH_ORIGIN = process.env.AUTH_ORIGIN || "http://localhost:7700";
const AUTH_CLIENT_ID =
  process.env.AUTH_CLIENT_ID || "52fcd42c-c6bb-458a-a7aa-2724760f9791";
const AUTH_CLIENT_SECRET =
  process.env.AUTH_CLIENT_SECRET || "46fd1f7c-7f07-43f7-9cc5-f74a2cd57a00";
const AUTHORIZATION_URL =
  process.env.AUTHORIZATION_ENDPOINT || `${AUTH_ORIGIN}/api/auth/signin`;
const JWKS_URL = `${AUTH_ORIGIN}/api/auth/certs`;
const TOKEN_URL = `${AUTH_ORIGIN}/api/auth/token`;
const publicDir = path.resolve("./public");

let cachedJwks = null;
let cachedJwksExpiresAt = 0;

function decodeBase64Url(value) {
  const normalizedValue = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalizedValue.length % 4;
  const paddedValue =
    padding === 0 ? normalizedValue : normalizedValue + "=".repeat(4 - padding);

  return Buffer.from(paddedValue, "base64");
}

function decodeJwt(token) {
  const tokenParts = token.split(".");

  if (tokenParts.length !== 3) {
    throw new Error("Malformed access token");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = tokenParts;
  const header = JSON.parse(decodeBase64Url(encodedHeader).toString("utf8"));
  const payload = JSON.parse(decodeBase64Url(encodedPayload).toString("utf8"));

  return {
    header,
    payload,
    encodedSignature,
    signingInput: `${encodedHeader}.${encodedPayload}`,
  };
}

async function getJwks() {
  if (cachedJwks && cachedJwksExpiresAt > Date.now()) {
    return cachedJwks;
  }

  const response = await fetch(JWKS_URL);
  if (!response.ok) {
    throw new Error(`Unable to fetch JWKS: ${response.status}`);
  }
  cachedJwks = await response.json();
  cachedJwksExpiresAt = Date.now() + 5 * 60 * 1000;
  return cachedJwks;
}

async function validateAccessToken(accessToken) {
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Missing access token");
  }

  const { header, payload, encodedSignature, signingInput } =
    decodeJwt(accessToken);

  if (header?.alg !== "RS256") {
    throw new Error("Unsupported token algorithm");
  }

  const jwks = await getJwks();
  const jwk = jwks?.keys?.find(
    (key) =>
      key.kty === "RSA" &&
      key.use === "sig" &&
      key.alg === "RS256" &&
      (!header?.kid || key.kid === header.kid),
  );

  if (!jwk) {
    throw new Error("Signing key not found");
  }

  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const isValid = verifySignature(
    "RSA-SHA256",
    Buffer.from(signingInput),
    publicKey,
    decodeBase64Url(encodedSignature),
  );

  if (!isValid) {
    throw new Error("Invalid access token signature");
  }

  if (payload.exp && payload.exp * 1000 <= Date.now()) {
    throw new Error("Access token expired");
  }

  if (payload.nbf && payload.nbf * 1000 > Date.now()) {
    throw new Error("Access token is not active yet");
  }

  return payload;
}

function getRedirectUri(req) {
  return (
    process.env.AUTH_REDIRECT_URI || `${req.protocol}://${req.get("host")}/auth`
  );
}

function getAuthCredentials() {
  if (!AUTH_CLIENT_ID || !AUTH_CLIENT_SECRET) {
    throw new Error("AUTH_CLIENT_ID and AUTH_CLIENT_SECRET must be set");
  }

  return {
    clientId: AUTH_CLIENT_ID,
    clientSecret: AUTH_CLIENT_SECRET,
  };
}

function getUserProfileFromClaims(claims) {
  const userName =
    claims.name ||
    claims.id ||
    claims.preferred_username ||
    claims.username ||
    claims.email ||
    claims.sub ||
    "Anonymous User";

  return {
    id: claims.id || claims.sub || userName,
    userName,
    email: claims.email || null,
  };
}

async function main() {
  const PORT = process.env.PORT ?? 5000;

  const app = express();
  const server = http.createServer(app);
  const io = new Server();

  app.use(express.json());

  const kafkaProducer = kafkaClient.producer();
  await kafkaProducer.connect();

  const kafkaConsumer = kafkaClient.consumer({
    groupId: `socket-server-${PORT}`,
  });
  await kafkaConsumer.connect();

  await kafkaConsumer.subscribe({
    topics: ["location-updates"],
    fromBeginning: false,
  });

  kafkaConsumer.run({
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      const data = JSON.parse(message.value.toString());
      console.log(`KafkaConsumer Data Received`, { data });
      io.emit("server:location:update", {
        id: data.id,
        userName: data.userName,
        latitude: data.latitude,
        longitude: data.longitude,
        updatedAt: data.updatedAt,
      });
      await heartbeat();
    },
  });

  io.attach(server);

  io.use(async (socket, next) => {
    try {
      const accessToken = socket.handshake.auth?.accessToken;
      const claims = await validateAccessToken(accessToken);
      socket.data.user = getUserProfileFromClaims(claims);
      next();
    } catch (error) {
      next(new Error(error.message || "Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;

    console.log(`[Socket:${socket.id}]: Connected Success...`, user);

    socket.emit("server:session", {
      socketId: socket.id,
      user,
    });

    socket.on("client:location:update", async (locationData) => {
      const { latitude, longitude } = locationData;
      console.log(
        `[Socket:${socket.id}]:client:location:update:`,
        locationData,
      );

      await kafkaProducer.send({
        topic: "location-updates",
        messages: [
          {
            key: socket.id,
            value: JSON.stringify({
              id: socket.id,
              userName: user.userName,
              latitude,
              longitude,
              updatedAt: new Date().toISOString(),
            }),
          },
        ],
      });
    });
  });

  app.get("/login", (req, res) => {
    try {
      const { clientId } = getAuthCredentials();
      const loginUrl = new URL(AUTHORIZATION_URL);

      loginUrl.searchParams.set("client_id", clientId);
      loginUrl.searchParams.set("redirect_uri", getRedirectUri(req));
      res.redirect(loginUrl.toString());
    } catch (error) {
      res.status(500).send(error.message);
    }
  });

  app.post("/auth/exchange", async (req, res) => {
    const code = req.body?.code;

    if (!code) {
      res.status(400).json({ message: "Missing authorization code." });
      return;
    }

    try {
      const { clientId, clientSecret } = getAuthCredentials();
      const tokenResponse = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          code,
          redirectUri: getRedirectUri(req),
        }),
      });
      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData?.data?.accessToken) {
        throw new Error(
          tokenData?.message || "Unable to complete authentication.",
        );
      }

      const claims = await validateAccessToken(tokenData.data.accessToken);

      res.json({
        accessToken: tokenData.data.accessToken,
        user: getUserProfileFromClaims(claims),
      });
    } catch (error) {
      res.status(500).json({
        message: error.message || "Authentication failed.",
      });
    }
  });

  app.get("/", (req, res) => {
    res.sendFile(path.join(publicDir, "login.html"));
  });

  app.get("/home", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.get("/auth", (req, res) => {
    res.sendFile(path.join(publicDir, "auth.html"));
  });

  app.get("/health", (req, res) => {
    return res.json({ healthy: true });
  });

  server.listen(PORT, () =>
    console.log(`Server running on http://localhost:${PORT}`),
  );
}

main();
