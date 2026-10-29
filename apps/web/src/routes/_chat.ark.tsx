import { createFileRoute } from "@tanstack/react-router";
import { ArkWorkspace } from "../components/ark/ArkWorkspace";

export const Route = createFileRoute("/_chat/ark")({ component: ArkWorkspace });
