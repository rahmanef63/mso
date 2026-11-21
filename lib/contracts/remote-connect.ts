export type RemoteProbeRequest =
  | {
      mode: "https-url";
      url: string;
    }
  | {
      mode: "local-existing";
      endpoint: string;
      dataDir?: string;
    }
  | {
      mode: "ssh-tunnel";
      sshUser: string;
      sshHost: string;
      sshPort?: number;
      remotePort: number;
      localPort?: number;
      identityFile?: string;
      testSsh?: boolean;
    };

export interface RemoteProbeCheck {
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
}

export interface RemoteProbeResult {
  ok: boolean;
  mode: RemoteProbeRequest["mode"];
  summary: string;
  checks: RemoteProbeCheck[];
  recommendation?: {
    embedMode?: "iframe" | "remote";
    suggestedUrl?: string;
    tunnelCommand?: string;
  };
}

export interface SshTunnelRecord {
  id: string;
  appId: string;
  title: string;
  sshUser: string;
  sshHost: string;
  sshPort: number;
  remotePort: number;
  localPort: number;
  identityFile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SshTunnelView extends SshTunnelRecord {
  active: boolean;
  pid: number | null;
  localUrl: string;
  error: string | null;
}

export interface SshTunnelSnapshot {
  schemaVersion: 1;
  sshAvailable: boolean;
  tunnels: SshTunnelView[];
}
