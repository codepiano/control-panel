import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Text,
  Textarea,
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
export default function Editor({ project, close, refresh }) {
  const [form, setForm] = useState({
      name: "",
      frontendUrl: "",
      frontendPort: "",
      notes: "",
    }),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    if (project) {
      const url = splitFrontendUrl(project.frontendUrl);
      setForm({
        name: project.name,
        frontendUrl: url.address,
        frontendPort: url.port,
        notes: project.notes || "",
      });
      setError("");
    }
  }, [project]);
  const field = (name) => ({
    value: form[name] || "",
    onChange: (e) =>
      setForm((old) => ({ ...old, [name]: e.currentTarget.value })),
  });
  return (
    <Modal
      opened={Boolean(project)}
      onClose={close}
      title="服务展示信息"
      size="lg"
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
            await api.saveProjectPresentation(project.key, form);
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
          <Text size="xs" c="dimmed" className="break-text">
            {project?.manifestPath} · 修改会直接保存到项目自身的
            control-panel.json。
          </Text>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <TextInput
            label="服务名称"
            required
            maxLength={80}
            {...field("name")}
            data-autofocus
          />
          <TextInput
            label="访问地址"
            type="url"
            placeholder="http://127.0.0.1"
            {...field("frontendUrl")}
          />
          <NumberInput
            label="端口（可选）"
            min={1}
            max={65535}
            allowDecimal={false}
            value={form.frontendPort || ""}
            onChange={(value) =>
              setForm((old) => ({ ...old, frontendPort: String(value) }))
            }
          />
          <Textarea label="备注" rows={3} maxLength={500} {...field("notes")} />
          <Text size="xs" c="dimmed">
            生命周期命令、工作目录和进程归属由服务自身维护。访问地址和端口会写入
            frontendUrl。
          </Text>
          <Group justify="end">
            <Button variant="default" onClick={close} disabled={saving}>
              取消
            </Button>
            <Button type="submit" loading={saving}>
              保存配置
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
