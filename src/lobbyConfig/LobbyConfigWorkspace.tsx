import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import {
  DeleteOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SaveOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { ResizableSplit } from '../components/ResizableSplit';
import type { LobbyProjectSnapshot } from './contracts';
import {
  applyMatchPreset,
  createDungeonEntry,
  createLobbyDocument,
  isPlainObject,
  removeDungeonEntry,
  removeMatchRule,
  serializeLobbyDocument,
  setMatchEnabled,
  syncDungeonCapacity,
  updateDungeonMode,
  updateMatchRule,
  validateLobbyDocument,
  type DungeonModeConfig,
  type LobbyDocument,
  type MatchPreset,
  type MatchRule,
} from './model';
import './LobbyConfig.css';

export interface LobbyConfigWorkspaceProps {
  onDirtyChange?: (dirty: boolean) => void;
}

interface LobbyEntrySummary {
  key: string;
  levelId: string;
  modeId: string;
  mapName: string;
  modeName: string;
  capabilityLabel: string;
  hasDungeon: boolean;
}

const presetOptions: Array<{ label: string; value: MatchPreset }> = [
  { label: '必须凑满真人', value: 'full-human' },
  { label: '定时机器人补位', value: 'timed-bots' },
  { label: '按分数段匹配', value: 'score-tiers' },
];

interface StableRow<T> {
  id: string;
  value: T;
}

let stableRowId = 0;

function createStableRow<T>(prefix: string, value: T): StableRow<T> {
  const id = `${prefix}-${stableRowId}`;
  stableRowId += 1;
  return { id, value };
}

export const LobbyConfigWorkspace = memo(function LobbyConfigWorkspace({ onDirtyChange }: LobbyConfigWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<LobbyProjectSnapshot | null>(null);
  const [document, setDocument] = useState<LobbyDocument | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedRuleIndex, setSelectedRuleIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newLevelId, setNewLevelId] = useState<string>();
  const [newModeId, setNewModeId] = useState<string>();
  const [saveOpen, setSaveOpen] = useState(false);
  const [editorClosed, setEditorClosed] = useState(false);
  const [activeInspectorTab, setActiveInspectorTab] = useState('dungeon');
  const [rowEditorVersion, setRowEditorVersion] = useState(0);
  const requestIdRef = useRef(0);

  const entries = useMemo(
    () => snapshot && document ? collectEntrySummaries(snapshot, document) : [],
    [snapshot, document],
  );
  const selectedEntry = entries.find((entry) => entry.key === selectedKey) ?? entries[0] ?? null;
  const matchRules = useMemo(() => {
    if (!selectedEntry || !document) return [];
    return document.matchRules.filter((rule) => isPlainObject(rule)
      && rule.level_id === selectedEntry.levelId
      && String(rule.game_mode) === selectedEntry.modeId);
  }, [document, selectedEntry]);
  const selectedRule = matchRules[selectedRuleIndex] ?? matchRules[0] ?? null;
  const editableSelectedRule = isEditableMatchRule(selectedRule) ? selectedRule : null;
  const dungeonMode = selectedEntry && document
    ? document.dungeonConfig[selectedEntry.levelId]?.game_modes?.[selectedEntry.modeId] ?? null
    : null;
  const issues = useMemo(() => snapshot && document ? validateLobbyDocument(document, {
    modeIds: snapshot.modes.map((mode) => mode.id),
    levelIds: snapshot.maps.map((map) => map.id),
  }) : [], [document, snapshot]);
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const serialized = useMemo(() => document ? serializeLobbyDocument(document) : null, [document]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!selectedKey && entries[0]) setSelectedKey(entries[0].key);
    if (selectedKey && !entries.some((entry) => entry.key === selectedKey)) setSelectedKey(entries[0]?.key ?? null);
  }, [entries, selectedKey]);

  useEffect(() => {
    if (selectedRuleIndex >= matchRules.length) setSelectedRuleIndex(Math.max(0, matchRules.length - 1));
  }, [matchRules.length, selectedRuleIndex]);

  useEffect(() => {
    if (errorCount > 0) setActiveInspectorTab('issues');
  }, [errorCount]);

  const loadProject = useCallback(async (projectPath: string) => {
    const api = window.electronAPI?.readLobbyConfigProject;
    if (!api) {
      setError('大厅配置仅支持 Y3 工具箱桌面版');
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api(projectPath);
      if (requestId !== requestIdRef.current) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSnapshot(result.snapshot);
      setDocument(createLobbyDocument({
        matchConfig: result.snapshot.match.config,
        dungeonConfig: result.snapshot.dungeon.config,
      }));
      setRowEditorVersion((version) => version + 1);
      setSelectedKey(null);
      setSelectedRuleIndex(0);
      setDirty(!result.snapshot.match.exists || !result.snapshot.dungeon.exists);
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const chooseProject = useCallback(async () => {
    const api = window.electronAPI?.openLobbyConfigDirectory;
    if (!api) {
      setError('大厅配置仅支持 Y3 工具箱桌面版');
      return;
    }
    const projectPath = await api();
    if (projectPath) await loadProject(projectPath);
  }, [loadProject]);

  const openProject = useCallback(() => {
    if (!dirty) {
      void chooseProject();
      return;
    }
    Modal.confirm({
      title: '放弃未保存修改？',
      content: '切换项目会丢失当前大厅配置修改。',
      okText: '放弃并切换',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => chooseProject(),
    });
  }, [chooseProject, dirty]);

  const changeDocument = useCallback((next: LobbyDocument) => {
    setDocument(next);
    setDirty(true);
    setError(null);
    setSuccess(null);
  }, []);

  const addEntry = useCallback(() => {
    if (!document || !newLevelId || !newModeId) return;
    const next = createDungeonEntry(document, newLevelId, newModeId);
    changeDocument(next);
    setSelectedKey(`${newLevelId}:${newModeId}`);
    setSelectedRuleIndex(0);
    setAddOpen(false);
  }, [changeDocument, document, newLevelId, newModeId]);

  const deleteEntry = useCallback(() => {
    if (!document || !selectedEntry) return;
    Modal.confirm({
      title: '删除整个副本？',
      content: '将同时删除该副本的 dungeon 配置及全部匹配规则。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => changeDocument(removeDungeonEntry(document, selectedEntry.levelId, selectedEntry.modeId)),
    });
  }, [changeDocument, document, selectedEntry]);

  const updateMode = useCallback((patch: Partial<DungeonModeConfig>) => {
    if (!document || !selectedEntry) return;
    changeDocument(updateDungeonMode(document, selectedEntry.levelId, selectedEntry.modeId, patch));
  }, [changeDocument, document, selectedEntry]);

  const updateRule = useCallback((patch: Partial<MatchRule>) => {
    if (!document || !selectedEntry || !selectedRule) return;
    changeDocument(updateMatchRule(document, selectedEntry.levelId, selectedEntry.modeId, selectedRuleIndex, patch));
  }, [changeDocument, document, selectedEntry, selectedRule, selectedRuleIndex]);

  const save = useCallback(async () => {
    if (!snapshot || !serialized || !editorClosed || errorCount > 0) return;
    const api = window.electronAPI?.saveLobbyConfigProject;
    if (!api) {
      setError('大厅配置仅支持 Y3 工具箱桌面版');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api({
        projectPath: snapshot.projectPath,
        matchRevision: snapshot.match.revision,
        dungeonRevision: snapshot.dungeon.revision,
        matchJson: serialized.matchJson,
        dungeonJson: serialized.dungeonJson,
      });
      if (!result.success) {
        setError(result.error);
        setSaveOpen(false);
        return;
      }
      setSnapshot({
        ...snapshot,
        match: { ...snapshot.match, exists: true, revision: result.revisions.matchRevision, config: document?.matchRules ?? [] },
        dungeon: { ...snapshot.dungeon, exists: true, revision: result.revisions.dungeonRevision, config: document?.dungeonConfig ?? {} },
      });
      setDirty(false);
      setSaveOpen(false);
      setEditorClosed(false);
      setSuccess('match.json 与 dungeon.json 已安全写入项目');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      setSaveOpen(false);
    } finally {
      setSaving(false);
    }
  }, [document, editorClosed, errorCount, serialized, snapshot]);

  if (!snapshot || !document) {
    return (
      <section className="lobby-config-workspace lobby-config-workspace--empty" aria-label="大厅配置">
        {error && <Alert type="error" showIcon message={error} />}
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择 Y3 源码项目，配置 match.json 与 dungeon.json">
          <Button type="primary" icon={<FolderOpenOutlined aria-hidden="true" />} loading={loading} onClick={openProject}>
            选择 Y3 项目
          </Button>
        </Empty>
      </section>
    );
  }

  const capacity = dungeonMode?.max_player_num ?? 0;
  const teamCapacity = editableSelectedRule
    ? editableSelectedRule.teams.reduce((sum, value) => sum + value, 0)
    : 0;

  return (
    <section className="lobby-config-workspace" aria-label="大厅配置">
      <header className="lobby-config-toolbar">
        <div className="lobby-config-project">
          <strong>{snapshot.projectName}</strong>
          <span title={snapshot.projectPath}>{snapshot.projectPath}</span>
        </div>
        <Tag color={snapshot.match.exists ? 'green' : 'gold'}>match.json {snapshot.match.exists ? '已加载' : '待创建'}</Tag>
        <Tag color={snapshot.dungeon.exists ? 'green' : 'gold'}>dungeon.json {snapshot.dungeon.exists ? '已加载' : '待创建'}</Tag>
        {errorCount > 0 && <Tag color="red">{errorCount} 个错误</Tag>}
        {warningCount > 0 && <Tag color="gold">{warningCount} 个警告</Tag>}
        {dirty && <Tag color="blue">未保存</Tag>}
        <Button icon={<FolderOpenOutlined aria-hidden="true" />} onClick={openProject}>切换项目</Button>
        <Button
          type="primary"
          icon={<SaveOutlined aria-hidden="true" />}
          disabled={!dirty}
          onClick={() => { setEditorClosed(false); setSaveOpen(true); }}
        >
          保存配置
        </Button>
      </header>
      {error && <Alert className="lobby-config-alert" type="error" showIcon message={error} closable onClose={() => setError(null)} />}
      {success && <Alert className="lobby-config-alert" type="success" showIcon message={success} closable onClose={() => setSuccess(null)} />}
      <Spin spinning={loading}>
        <div className="lobby-config-layout">
          <ResizableSplit
            className="lobby-config-primary-split"
            defaultRatio={0.22}
            minRatio={0.14}
            maxRatio={0.38}
            paneOverflow="hidden"
            separatorLabel="调整副本列表宽度"
            left={(
          <aside className="lobby-config-sidebar" aria-label="副本列表">
            <div className="lobby-config-sidebar__header">
              <span>副本</span>
              <Tooltip title="新增副本">
                <Button size="small" type="text" aria-label="新增副本" icon={<PlusOutlined aria-hidden="true" />} onClick={() => {
                  setNewLevelId(snapshot.maps[0]?.id);
                  setNewModeId(snapshot.modes[0]?.id);
                  setAddOpen(true);
                }} />
              </Tooltip>
            </div>
            {entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`lobby-config-entry${selectedEntry?.key === entry.key ? ' lobby-config-entry--active' : ''}`}
                onClick={() => { setSelectedKey(entry.key); setSelectedRuleIndex(0); }}
              >
                <span>{entry.mapName}</span>
                <strong>{entry.modeName}（{entry.modeId}）</strong>
                <small>{entry.capabilityLabel}</small>
              </button>
            ))}
          </aside>
            )}
            right={(
              <ResizableSplit
                className="lobby-config-secondary-split"
                defaultRatio={0.64}
                minRatio={0.42}
                maxRatio={0.82}
                paneOverflow="hidden"
                separatorLabel="调整检查面板宽度"
                left={(
          <main className="lobby-config-editor">
            {selectedEntry ? (
              <>
                <div className="lobby-config-editor__heading">
                  <div>
                    <h2>{selectedEntry.mapName} · {selectedEntry.modeName}</h2>
                    <p><code>{selectedEntry.levelId}</code><span>模式 {selectedEntry.modeId}</span></p>
                  </div>
                  <Tooltip title="删除整个副本">
                    <Button danger aria-label="删除整个副本" icon={<DeleteOutlined aria-hidden="true" />} onClick={deleteEntry} />
                  </Tooltip>
                </div>

                {!dungeonMode ? (
                  <Alert
                    type="error"
                    showIcon
                    message="dungeon.json 缺少该条目"
                    action={<Button onClick={() => changeDocument(createDungeonEntry(document, selectedEntry.levelId, selectedEntry.modeId))}>创建 dungeon 配置</Button>}
                  />
                ) : (
                  <section className="lobby-config-section" aria-labelledby="dungeon-settings-title">
                    <h3 id="dungeon-settings-title">副本进入设置</h3>
                    <div className="lobby-config-form-grid">
                      <ToggleField
                        label="允许公开进入"
                        id="lobby-enable-public"
                        checked={dungeonMode.enable_public === 1}
                        onChange={(checked) => updateMode({ enable_public: checked ? 1 : 0 })}
                      />
                      <ToggleField
                        label="允许私人进入"
                        id="lobby-enable-private"
                        checked={dungeonMode.enable_private === 1}
                        onChange={(checked) => updateMode({ enable_private: checked ? 1 : 0 })}
                      />
                      <Field label="房间容量" htmlFor="lobby-max-player">
                        <InputNumber id="lobby-max-player" min={1} precision={0} value={dungeonMode.max_player_num} onChange={(value) => value !== null && updateMode({ max_player_num: Number(value) })} />
                      </Field>
                      <Field label="允许中途加入（秒）" htmlFor="lobby-add-time">
                        <InputNumber id="lobby-add-time" min={0} precision={0} value={dungeonMode.can_add_in_time} onChange={(value) => value !== null && updateMode({ can_add_in_time: Number(value) })} />
                      </Field>
                    </div>
                  </section>
                )}

                <section className="lobby-config-section" aria-labelledby="match-settings-title">
                  <div className="lobby-config-section__header">
                    <h3 id="match-settings-title">匹配设置</h3>
                    <label className="lobby-config-inline-switch">
                      <span>参与匹配</span>
                      <Switch
                        checked={matchRules.length > 0}
                        onChange={(checked) => {
                          changeDocument(setMatchEnabled(document, selectedEntry.levelId, selectedEntry.modeId, checked));
                          setSelectedRuleIndex(0);
                        }}
                      />
                    </label>
                  </div>
                  {selectedRule && (
                    <>
                      {matchRules.length > 1 && (
                        <div className="lobby-config-rule-toolbar">
                          <Segmented
                            size="small"
                            value={selectedRuleIndex}
                            onChange={(value) => setSelectedRuleIndex(Number(value))}
                            options={matchRules.map((_, index) => ({ label: `规则 ${index + 1}`, value: index }))}
                          />
                          <Tooltip title="删除当前匹配规则">
                            <Button size="small" danger aria-label="删除当前匹配规则" icon={<DeleteOutlined aria-hidden="true" />} onClick={() => {
                              changeDocument(removeMatchRule(document, selectedEntry.levelId, selectedEntry.modeId, selectedRuleIndex));
                              setRowEditorVersion((version) => version + 1);
                            }} />
                          </Tooltip>
                        </div>
                      )}
                      {editableSelectedRule ? (
                        <>
                      <div className="lobby-config-presets">
                        <span>快捷预设</span>
                        {presetOptions.map((preset) => (
                          <Button
                            key={preset.value}
                            size="small"
                            onClick={() => {
                              changeDocument(applyMatchPreset(
                                document,
                                selectedEntry.levelId,
                                selectedEntry.modeId,
                                selectedRuleIndex,
                                preset.value,
                              ));
                              setRowEditorVersion((version) => version + 1);
                            }}
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>

                      <DynamicNumberList
                        key={`teams:${selectedEntry.key}:${selectedRuleIndex}:${rowEditorVersion}`}
                        title="阵营人数"
                        itemLabel="阵营"
                        values={editableSelectedRule.teams}
                        min={1}
                        onChange={(teams) => updateRule({ teams })}
                      />
                      {teamCapacity > capacity && dungeonMode && (
                        <Alert
                          className="lobby-config-inline-alert"
                          type="error"
                          showIcon
                          message={`阵营总人数 ${teamCapacity} 超过房间容量 ${capacity}`}
                          action={(
                            <Button
                              icon={<SyncOutlined aria-hidden="true" />}
                              onClick={() => changeDocument(syncDungeonCapacity(document, selectedEntry.levelId, selectedEntry.modeId, selectedRuleIndex))}
                            >
                              同步房间容量至 {teamCapacity}
                            </Button>
                          )}
                        />
                      )}
                      <DynamicNumberList
                        key={`diffuse:${selectedEntry.key}:${selectedRuleIndex}:${rowEditorVersion}`}
                        title="分数段扩散时间（秒）"
                        itemLabel="时间点"
                        valueUnit=""
                        values={editableSelectedRule.diffuse_time}
                        min={0}
                        onChange={(diffuse_time) => updateRule({ diffuse_time })}
                      />
                      <Field label="机器人兜底时间（秒）" htmlFor="lobby-bot-fill-time">
                        <InputNumber
                          id="lobby-bot-fill-time"
                          min={0}
                          precision={0}
                          value={editableSelectedRule.bot_fill_time ?? 0}
                          onChange={(value) => value !== null && updateRule({ bot_fill_time: Number(value) })}
                        />
                      </Field>
                      <MatchSectionsEditor
                        key={`sections:${selectedEntry.key}:${selectedRuleIndex}:${rowEditorVersion}`}
                        rule={editableSelectedRule}
                        onChange={(sections) => updateRule({ sections })}
                      />
                        </>
                      ) : (
                        <Alert
                          className="lobby-config-inline-alert"
                          type="error"
                          showIcon
                          message="当前匹配规则结构无效"
                          description="请在检查面板查看具体字段；可删除该规则或关闭此副本的匹配。"
                        />
                      )}
                    </>
                  )}
                </section>
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="项目中还没有副本">
                <Button icon={<PlusOutlined aria-hidden="true" />} onClick={() => setAddOpen(true)}>新增副本</Button>
              </Empty>
            )}
          </main>
                )}
                right={(
          <aside className="lobby-config-inspector" aria-label="校验与 JSON 预览">
            <Tabs
              activeKey={activeInspectorTab}
              onChange={setActiveInspectorTab}
              items={[
                {
                  key: 'issues',
                  label: `检查 ${issues.length > 0 ? `(${issues.length})` : ''}`,
                  children: issues.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有发现配置问题" /> : (
                    <div className="lobby-config-issues">
                      {issues.map((issue, index) => (
                        <Alert key={`${issue.path}:${issue.code}:${index}`} type={issue.severity} showIcon message={issue.message} description={<code>{issue.path}</code>} />
                      ))}
                    </div>
                  ),
                },
                { key: 'match', label: 'match.json', children: <pre>{serialized?.matchJson}</pre> },
                { key: 'dungeon', label: 'dungeon.json', children: <pre>{serialized?.dungeonJson}</pre> },
              ]}
            />
          </aside>
                )}
              />
            )}
          />
        </div>
      </Spin>

      <Modal
        title="新增副本"
        open={addOpen}
        okText="新增"
        cancelText="取消"
        okButtonProps={{ disabled: !newLevelId || !newModeId || entries.some((entry) => entry.levelId === newLevelId && entry.modeId === newModeId) }}
        onOk={addEntry}
        onCancel={() => setAddOpen(false)}
      >
        <div className="lobby-config-modal-fields">
          <Field label="关卡" htmlFor="lobby-new-level">
            <Select
              id="lobby-new-level"
              value={newLevelId}
              onChange={setNewLevelId}
              options={snapshot.maps.map((map) => ({ label: `${map.directory} · ${map.id}`, value: map.id }))}
            />
          </Field>
          <Field label="模式" htmlFor="lobby-new-mode">
            <Select
              id="lobby-new-mode"
              value={newModeId}
              onChange={setNewModeId}
              options={snapshot.modes.map((mode) => ({ label: `${mode.name} · ${mode.id}`, value: mode.id }))}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        title="确认写入大厅配置"
        open={saveOpen}
        okText="确认写入"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: !editorClosed || errorCount > 0 }}
        onOk={() => void save()}
        onCancel={() => setSaveOpen(false)}
      >
        <Alert
          type="warning"
          showIcon
          message="工具不会创建持久备份"
          description="写入前请自行备份项目。Y3 编辑器运行时会用内存中的旧配置覆盖外部修改。"
        />
        <div className="lobby-config-save-summary">
          <span>{document.matchRules.length} 条匹配规则</span>
          <span>{entries.filter((entry) => entry.hasDungeon).length} 个副本配置</span>
          {warningCount > 0 && <span>{warningCount} 个警告将一并保存</span>}
          {errorCount > 0 && <span className="lobby-config-save-summary__error">仍有 {errorCount} 个错误，不能保存</span>}
        </div>
        <Checkbox checked={editorClosed} onChange={(event) => setEditorClosed(event.target.checked)}>
          已完全关闭 Y3 编辑器
        </Checkbox>
      </Modal>
    </section>
  );
});

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="lobby-config-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function ToggleField({
  label,
  id,
  checked,
  onChange,
}: {
  label: string;
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="lobby-config-toggle-field">
      <label htmlFor={id}>{label}</label>
      <Switch id={id} size="small" checked={checked} onChange={onChange} />
    </div>
  );
}

function DynamicNumberList({
  title,
  itemLabel,
  values,
  min,
  valueUnit = '人数',
  onChange,
}: {
  title: string;
  itemLabel: string;
  values: number[];
  min: number;
  valueUnit?: string;
  onChange: (values: number[]) => void;
}) {
  const [rows, setRows] = useStableRows(values, 'number-row');
  const commit = (nextRows: Array<StableRow<number>>) => {
    setRows(nextRows);
    onChange(nextRows.map((row) => row.value));
  };

  return (
    <div className="lobby-config-array-editor">
      <div className="lobby-config-array-editor__header">
        <strong>{title}</strong>
        <Button size="small" icon={<PlusOutlined aria-hidden="true" />} onClick={() => {
          commit([...rows, createStableRow('number-row', Math.max(min, rows.at(-1)?.value ?? min))]);
        }}>新增</Button>
      </div>
      <div className="lobby-config-array-editor__rows">
        {rows.map((row, index) => {
          const rowLabel = `${itemLabel} ${index + 1}${valueUnit ? ` ${valueUnit}` : ''}`;
          return (
          <div className="lobby-config-array-row" key={row.id}>
            <label htmlFor={`lobby-${itemLabel}-${index}`}>{rowLabel}</label>
            <InputNumber
              id={`lobby-${itemLabel}-${index}`}
              aria-label={rowLabel}
              min={min}
              precision={0}
              value={row.value}
              onChange={(nextValue) => nextValue !== null && commit(rows.map((item, itemIndex) => (
                itemIndex === index ? { ...item, value: Number(nextValue) } : item
              )))}
            />
            <Button
              size="small"
              type="text"
              danger
              aria-label={`删除${itemLabel} ${index + 1}`}
              icon={<DeleteOutlined aria-hidden="true" />}
              disabled={rows.length <= 1}
              onClick={() => {
                commit(rows.filter((_, itemIndex) => itemIndex !== index));
              }}
            />
          </div>
          );
        })}
      </div>
    </div>
  );
}

function MatchSectionsEditor({ rule, onChange }: { rule: MatchRule; onChange: (sections: MatchRule['sections']) => void }) {
  const [rows, setRows] = useStableRows(rule.sections, 'section-row');
  const commit = (nextRows: Array<StableRow<MatchRule['sections'][number]>>) => {
    setRows(nextRows);
    onChange(nextRows.map((row) => row.value));
  };

  return (
    <div className="lobby-config-array-editor">
      <div className="lobby-config-array-editor__header">
        <strong>分数段与最低真人数</strong>
        <Button size="small" icon={<PlusOutlined aria-hidden="true" />} onClick={() => {
          commit([...rows, createStableRow('section-row', {
            max_score: (rows.at(-1)?.value.max_score ?? 0) + 1000,
            min_player_num: Math.max(1, Math.min(rule.teams.reduce((sum, value) => sum + value, 0), rows.at(-1)?.value.min_player_num ?? 1)),
          })]);
        }}>新增分数段</Button>
      </div>
      <div className="lobby-config-section-table" role="table" aria-label="匹配分数段">
        <div className="lobby-config-section-row lobby-config-section-row--header" role="row">
          <span role="columnheader">匹配分上限</span>
          <span role="columnheader">最低真人数</span>
          <span aria-hidden="true" />
        </div>
        {rows.map((row, index) => (
          <div className="lobby-config-section-row" role="row" key={row.id}>
            <InputNumber
              aria-label={`分数段 ${index + 1} 上限`}
              precision={0}
              value={row.value.max_score}
              onChange={(value) => value !== null && commit(rows.map((item, itemIndex) => itemIndex === index
                ? { ...item, value: { ...item.value, max_score: Number(value) } }
                : item))}
            />
            <InputNumber
              aria-label={`分数段 ${index + 1} 最低真人数`}
              min={1}
              precision={0}
              value={row.value.min_player_num}
              onChange={(value) => value !== null && commit(rows.map((item, itemIndex) => itemIndex === index
                ? { ...item, value: { ...item.value, min_player_num: Number(value) } }
                : item))}
            />
            <Button
              size="small"
              type="text"
              danger
              aria-label={`删除分数段 ${index + 1}`}
              icon={<DeleteOutlined aria-hidden="true" />}
              disabled={rows.length <= 1}
              onClick={() => {
                commit(rows.filter((_, itemIndex) => itemIndex !== index));
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function useStableRows<T>(values: T[], prefix: string) {
  const [rows, setRows] = useState(() => values.map((value) => createStableRow(prefix, value)));
  return [rows, setRows] as const;
}

function isEditableMatchRule(value: unknown): value is MatchRule {
  return isPlainObject(value)
    && Array.isArray(value.teams)
    && value.teams.every((item) => typeof item === 'number')
    && Array.isArray(value.diffuse_time)
    && value.diffuse_time.every((item) => typeof item === 'number')
    && Array.isArray(value.sections)
    && value.sections.every((section) => isPlainObject(section)
      && typeof section.max_score === 'number'
      && typeof section.min_player_num === 'number');
}

function collectEntrySummaries(snapshot: LobbyProjectSnapshot, document: LobbyDocument): LobbyEntrySummary[] {
  const keys = new Set<string>();
  for (const [levelId, level] of Object.entries(document.dungeonConfig)) {
    if (!level || typeof level !== 'object' || Array.isArray(level) || !level.game_modes || typeof level.game_modes !== 'object' || Array.isArray(level.game_modes)) continue;
    for (const modeId of Object.keys(level.game_modes)) keys.add(`${levelId}:${modeId}`);
  }
  for (const rule of document.matchRules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
    if (typeof rule.level_id !== 'string' || (typeof rule.game_mode !== 'string' && typeof rule.game_mode !== 'number')) continue;
    keys.add(`${rule.level_id}:${String(rule.game_mode)}`);
  }

  return [...keys].map((key) => {
    const separator = key.lastIndexOf(':');
    const levelId = key.slice(0, separator);
    const modeId = key.slice(separator + 1);
    const modeConfig = document.dungeonConfig[levelId]?.game_modes?.[modeId];
    const capabilities = [
      modeConfig?.enable_public === 1 ? '公开进入' : null,
      modeConfig?.enable_private === 1 ? '私人副本' : null,
      document.matchRules.some((rule) => rule.level_id === levelId && String(rule.game_mode) === modeId) ? '匹配' : null,
    ].filter((capability): capability is string => capability !== null);
    return {
      key,
      levelId,
      modeId,
      mapName: snapshot.maps.find((map) => map.id === levelId)?.directory ?? `未知关卡 ${levelId}`,
      modeName: snapshot.modes.find((mode) => mode.id === modeId)?.name ?? `未知模式 ${modeId}`,
      capabilityLabel: capabilities.length > 0 ? `支持${capabilities.join(' + ')}` : '未启用功能',
      hasDungeon: Boolean(modeConfig),
    };
  });
}
