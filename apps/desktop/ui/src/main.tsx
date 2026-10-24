import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import "./tokens.css";
import "./app.css";
import { render } from "preact";
import { App } from "./App.tsx";
import { createBridgeTransport, readToken } from "./transport.ts";

const token = readToken(window);
const root = document.getElementById("root")!;
if (!token) {
  root.textContent = "Open ATOM from the address printed when it started. That address includes the access token after #.";
} else {
  render(<App transport={createBridgeTransport(token)} />, root);
}
