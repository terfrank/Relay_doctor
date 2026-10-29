export type Status = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';

export interface ProjectWorkspaceSession {
  workspaceKey: string;
  enrolledNodeId?: string;
  workspaceId?: string;
  relaycastRoute?: 'canonical' | 'agent37-isolated';
  relaycastBaseUrl?: string;
  relaycastCloudApiUrl?: string;
  relaycastApiKey?: string;
  relaycastApiKeyRef?: string;
}

export interface FleetNodeEnrollmentRecord {
  nodeId: string;
  nodeName: string;
  nodeToken: string;
  relayWorkspaceId: string;
  relaycastUrl: string;
  websocketUrl: string;
  enrolledAt: string;
}

export interface FleetNodeEnrollmentStore {
  version: 1;
  active: Record<string, string>;
  nodes: Record<string, FleetNodeEnrollmentRecord>;
}

export interface BrokerConnection {
  url: string;
  api_key: string;
  pid: number;
}

export interface CheckItem {
  id: string;
  name: string;
  status: Status;
  source: string;
  message: string;
  remediation?: string;
}

export interface CheckResult {
  status: Status;
  summary: string;
  checks: CheckItem[];
}

export interface ExplainFinding {
  id: string;
  status: Status;
  source: string;
  signature: string;
  diagnosis: string;
  matchedLogLine?: string;
  remediation?: string;
}

export interface ExplainResult {
  status: Status;
  summary: string;
  findings: ExplainFinding[];
}
