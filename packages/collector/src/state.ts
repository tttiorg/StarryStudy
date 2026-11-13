// 运行状态只放内存：采集器是一次性脚本，进程退出即结束。
// 会话 cookie 也只在内存里，绝不落盘——v1 的 bb.json 存过账号密码，
// §10.3 明确不迁移它，v2 连状态文件都不该再造一份。
import { nowIso, type IngestSummary } from "@starry/shared";

export interface SourceState {
  ok: boolean;
  at: string;
  summary?: IngestSummary;
  error?: string;
}

export class RunState {
  readonly at: string = nowIso();
  readonly sources: Record<string, SourceState> = {};

  constructor(readonly dryRun: boolean) {}

  record(id: string, ok: boolean, patch: { summary?: IngestSummary; error?: string } = {}): void {
    this.sources[id] = { ok, at: nowIso(), ...patch };
  }
}
