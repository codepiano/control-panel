import React, { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "../components-overlays.jsx";
import model from "../model.cjs";
const {
  formatTimestamp: timestamp,
  splitFrontendUrl,
  repositoryNeedsAttention: needsAttention,
  repositoryCanSync: canSync,
  repositoryStatusText: repoText,
  repositoryActionGuidance: repoGuidance,
  repositoryResults,
} = model;
const api = window.controlPanel;
export default function Organization({ projects, groups, close, refresh }) {
  const [group, setGroup] = useState(""),
    [tags, setTags] = useState(""),
    [favorite, setFavorite] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const batch = projects?.length > 1;
  useEffect(() => {
    if (projects) {
      setGroup(projects.length > 1 ? "" : projects[0]?.localGroup || "");
      setTags((projects[0]?.tags || []).join(", "));
      setFavorite(Boolean(projects[0]?.favorite));
      setError("");
    }
  }, [projects]);
  return (
    <Modal
      opened={Boolean(projects)}
      onClose={close}
      title={batch ? "批量归组" : "服务标记与分组"}
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
      withCloseButton={!saving}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          setSaving(true);
          setError("");
          try {
            await api.saveProjectOrganization(
              projects.map((p) => p.key),
              {
                group,
                ...(!batch ? { tags: tags.split(/[,，]/), favorite } : {}),
              },
            );
            close();
            await refresh();
          } catch (err) {
            setError(err.message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {batch
              ? `为所选 ${projects?.length} 个服务设置同一个分组`
              : projects?.[0]?.name}
          </Text>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Autocomplete
            label="分组"
            placeholder="输入或选择分组；留空使用所属集合"
            data={groups}
            maxLength={40}
            value={group}
            onChange={setGroup}
            data-autofocus
          />

          {!batch && (
            <>
              <TextInput
                label="标签"
                placeholder="例如：常驻, 开发, 数据库"
                value={tags}
                onChange={(e) => setTags(e.currentTarget.value)}
              />
              <Checkbox
                label="星标服务"
                checked={favorite}
                onChange={(e) => setFavorite(e.currentTarget.checked)}
              />
            </>
          )}
          <Text size="xs" c="dimmed">
            分组与标记保存在本机。批量归组只修改分组，保留标签与星标。
          </Text>
          <Group justify="end">
            <Button type="submit" loading={saving}>
              保存
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
