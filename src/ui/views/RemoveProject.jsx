import React, { useState } from "react";
import { Alert, Button, Checkbox, Group, Modal, Stack, Text } from "../components-overlays.jsx";

export default function RemoveProject({ project, busy, close, remove }) {
  const [deleteDirectory, setDeleteDirectory] = useState(false);
  const [error, setError] = useState("");
  const canDelete = Boolean(project.projectDir) && !["running", "starting", "stopping"].includes(project.status);
  return (
    <Modal
      opened
      onClose={close}
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
      title={<Text fw={700}>移除项目</Text>}
    >
      <Stack gap="md">
        <Text size="sm">将「{project.name}」从控制面板移除。</Text>
        {project.projectDir && (
          <Text size="xs" c="dimmed" className="break-text">{project.projectDir}</Text>
        )}
        <Checkbox
          label="同时永久删除项目目录"
          description={canDelete ? "将删除该目录及其中的所有文件。" : project.projectDir ? "请先停止项目，再删除目录。" : "项目未配置目录。"}
          checked={deleteDirectory}
          disabled={busy || (!canDelete && !deleteDirectory)}
          onChange={(event) => setDeleteDirectory(event.currentTarget.checked)}
        />
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={close} disabled={busy}>取消</Button>
          <Button
            color="red"
            loading={busy}
            disabled={deleteDirectory && !canDelete}
            onClick={() => {
              setError("");
              remove(deleteDirectory, setError);
            }}
          >
            {deleteDirectory ? "移除并删除目录" : "确认移除"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
