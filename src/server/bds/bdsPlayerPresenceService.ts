const playerConnectedPattern = /Player connected: (.*), xuid: ([^,]*)(?:,|$)/;
const playerDisconnectedPattern = /Player disconnected: (.*), xuid: ([^,]*)(?:,|$)/;

type PlayerPresenceEvent = {
  type: "connected" | "disconnected";
  playerKey: string;
};

function buildPlayerKey(playerName: string, xuid: string): string | undefined {
  const normalizedXuid = xuid.trim();
  if (normalizedXuid && normalizedXuid !== "0" && normalizedXuid !== "-1") {
    return `xuid:${normalizedXuid}`;
  }

  const normalizedName = playerName.trim().toLocaleLowerCase();
  return normalizedName ? `name:${normalizedName}` : undefined;
}

export function parseBdsPlayerPresenceLine(line: string): PlayerPresenceEvent | undefined {
  const connectedMatch = line.match(playerConnectedPattern);
  const connectedPlayerKey = connectedMatch ? buildPlayerKey(connectedMatch[1] ?? "", connectedMatch[2] ?? "") : undefined;
  if (connectedPlayerKey) {
    return { type: "connected", playerKey: connectedPlayerKey };
  }

  const disconnectedMatch = line.match(playerDisconnectedPattern);
  const disconnectedPlayerKey = disconnectedMatch
    ? buildPlayerKey(disconnectedMatch[1] ?? "", disconnectedMatch[2] ?? "")
    : undefined;
  if (disconnectedPlayerKey) {
    return { type: "disconnected", playerKey: disconnectedPlayerKey };
  }

  return undefined;
}

export class BdsPlayerPresenceTracker {
  private activePlayers = new Map<string, Set<string>>();
  private lineRemainders = new Map<string, string>();

  startTracking(instanceId: string): void {
    this.activePlayers.set(instanceId, new Set());
    this.lineRemainders.set(instanceId, "");
  }

  stopTracking(instanceId: string): void {
    this.activePlayers.delete(instanceId);
    this.lineRemainders.delete(instanceId);
  }

  appendOutput(instanceId: string, chunk: string): void {
    const bufferedOutput = `${this.lineRemainders.get(instanceId) ?? ""}${chunk}`.replaceAll("\r", "");
    const lines = bufferedOutput.split("\n");
    const remainder = lines.pop() ?? "";
    this.lineRemainders.set(instanceId, remainder);

    for (const line of lines) {
      this.applyEvent(instanceId, parseBdsPlayerPresenceLine(line));
    }
  }

  getPlayerCount(instanceId: string): number | undefined {
    return this.activePlayers.get(instanceId)?.size;
  }

  private applyEvent(instanceId: string, event: PlayerPresenceEvent | undefined): void {
    if (!event) {
      return;
    }

    const players = this.activePlayers.get(instanceId);
    if (!players) {
      return;
    }

    if (event.type === "connected") {
      players.add(event.playerKey);
      return;
    }

    players.delete(event.playerKey);
  }
}
