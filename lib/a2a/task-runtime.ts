import { abortA2AActiveTask } from "./task-active";
import { taskPublicView, updateA2ATask } from "./task-store";

export async function cancelA2AActiveTask(id: string, principal: string) {
  abortA2AActiveTask(id);
  const task = await updateA2ATask(id, principal, {
    state: "TASK_STATE_CANCELED",
  });
  return taskPublicView(task);
}
