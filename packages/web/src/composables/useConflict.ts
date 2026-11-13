import { ElMessage } from "element-plus";
import { isConflictError, msgOf } from "@/api";
import { useUiStore } from "@/stores/ui";
import type { ConflictChoice } from "@/stores/ui";

export interface WriteOutcome<T> {
  ok: boolean;
  item?: T;
  choice?: ConflictChoice | "error";
  server?: T;
  error?: unknown;
}

/**
 * 所有写操作的 409 都在这里收敛（§8.6，验收 #8）。
 *
 * 先按本地 rev 写一次；冲突时把「我的草稿」和「服务端当前完整记录」摆给用户选，
 * 绝不静默重试、绝不静默覆盖。只有用户明确点「保留我的」，才用 server.rev 再写一次
 * —— 这是用户授权后的覆盖，和偷偷重试是两回事。
 */
export async function guardedWrite<T extends { rev: number }>(
  draft: Record<string, unknown>,
  run: (rev: number) => Promise<T>,
  apply: (item: T) => void,
  baseRev: number,
): Promise<WriteOutcome<T>> {
  const ui = useUiStore();
  try {
    const item = await run(baseRev);
    apply(item);
    return { ok: true, item };
  } catch (e) {
    if (!isConflictError(e)) {
      ElMessage.error(msgOf(e));
      return { ok: false, choice: "error", error: e };
    }

    const server = e.server as unknown as T;
    const choice = await ui.openConflict(
      draft,
      server as unknown as Record<string, unknown>,
    );

    if (choice === "mine") {
      try {
        const item = await run(server.rev);
        apply(item);
        return { ok: true, item, choice: "mine" };
      } catch (e2) {
        ElMessage.error(msgOf(e2));
        return { ok: false, choice: "error", error: e2 };
      }
    }
    if (choice === "server") {
      apply(server);
      return { ok: true, item: server, choice: "server", server };
    }
    return { ok: false, choice: "cancel", server };
  }
}
