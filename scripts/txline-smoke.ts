type Env = {
  TXLINE_BASE_URL?: string;
  TXLINE_JWT?: string;
  TXLINE_API_TOKEN?: string;
};

export {};

const env = process.env as Env;

if (!env.TXLINE_BASE_URL || !env.TXLINE_JWT || !env.TXLINE_API_TOKEN) {
  throw new Error("Set TXLINE_BASE_URL, TXLINE_JWT, and TXLINE_API_TOKEN before running smoke:txline.");
}

const url = new URL("/api/fixtures/snapshot", env.TXLINE_BASE_URL);
const response = await fetch(url, {
  headers: {
    Authorization: `Bearer ${env.TXLINE_JWT}`,
    "X-Api-Token": env.TXLINE_API_TOKEN,
    Accept: "application/json"
  }
});

console.log(`TxLINE fixtures snapshot: ${response.status} ${response.statusText}`);
const text = await response.text();
console.log(text.slice(0, 1200));

if (!response.ok) {
  process.exitCode = 1;
}
