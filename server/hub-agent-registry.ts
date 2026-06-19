import type { HubMachineAgent } from "@opzero/codez-hub-client";

let hubAgent: HubMachineAgent | null = null;

export function setHubMachineAgent(agent: HubMachineAgent | null): void {
  hubAgent = agent;
}

export function getHubMachineAgent(): HubMachineAgent | null {
  return hubAgent;
}
