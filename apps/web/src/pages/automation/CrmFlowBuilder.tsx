import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useI18n } from "@/i18n/I18nProvider";
import { CRM_BLOCK_GROUPS, type CrmFlowDefinition } from "./crmFlowTypes";

type CrmNodeData = { blockType: string; blockData: Record<string, unknown> };

function CrmFlowNodeCard({ data, selected }: NodeProps<Node<CrmNodeData>>) {
  const { t } = useI18n();
  const label =
    t(`crmFlows.blockType.${data.blockType}`) !== `crmFlows.blockType.${data.blockType}`
      ? t(`crmFlows.blockType.${data.blockType}`)
      : data.blockType;
  const isCondition = data.blockType === "condition";
  return (
    <div
      className={`min-w-[160px] rounded-xl border-2 bg-white px-3 py-2 shadow-sm dark:bg-ink-900 ${
        selected ? "border-brand-500" : "border-ink-200 dark:border-ink-600"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-brand-500" />
      <p className="text-xs font-semibold text-brand-600 dark:text-brand-400">{label}</p>
      {data.blockType === "trigger" && data.blockData.triggerType ? (
        <p className="mt-1 text-[10px] text-ink-500">{String(data.blockData.triggerType)}</p>
      ) : null}
      {isCondition ? (
        <>
          <Handle type="source" id="yes" position={Position.Bottom} style={{ left: "30%" }} className="!bg-emerald-500" />
          <Handle type="source" id="no" position={Position.Bottom} style={{ left: "70%" }} className="!bg-rose-500" />
        </>
      ) : data.blockType !== "end" ? (
        <Handle type="source" position={Position.Bottom} className="!bg-brand-500" />
      ) : null}
    </div>
  );
}

const nodeTypes = { crmBlock: CrmFlowNodeCard };

function flowToRf(flow: CrmFlowDefinition): { nodes: Node<CrmNodeData>[]; edges: Edge[] } {
  return {
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      type: "crmBlock",
      position: n.position ?? { x: 0, y: 0 },
      data: { blockType: n.type, blockData: n.data ?? {} },
    })),
    edges: flow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.branch,
      type: "smoothstep",
      style: { stroke: "#2563eb", strokeWidth: 2 },
    })),
  };
}

function rfToFlow(nodes: Node<CrmNodeData>[], edges: Edge[]): CrmFlowDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.blockType,
      position: n.position,
      data: n.data.blockData,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      branch: e.sourceHandle ?? undefined,
    })),
  };
}

interface TagOption {
  id: string;
  name: string;
}

interface UserOption {
  id: string;
  name: string;
}

interface Props {
  value: CrmFlowDefinition;
  onChange: (flow: CrmFlowDefinition) => void;
  tags?: TagOption[];
  users?: UserOption[];
}

export function CrmFlowBuilder({ value, onChange, tags = [], users = [] }: Props) {
  const { t } = useI18n();
  const initial = useMemo(() => flowToRf(value), [value]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const skipSync = useRef(false);
  const flowIdRef = useRef(JSON.stringify(value));

  useEffect(() => {
    const key = JSON.stringify(value);
    if (key === flowIdRef.current) return;
    flowIdRef.current = key;
    const next = flowToRf(value);
    skipSync.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedNodeId(null);
  }, [value, setNodes, setEdges]);

  useEffect(() => {
    if (skipSync.current) {
      skipSync.current = false;
      return;
    }
    const flow = rfToFlow(nodes, edges);
    const key = JSON.stringify(flow);
    if (key !== flowIdRef.current) {
      flowIdRef.current = key;
      onChange(flow);
    }
  }, [nodes, edges, onChange]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "smoothstep",
            style: { stroke: "#2563eb", strokeWidth: 2 },
            id: `e_${connection.source}_${connection.sourceHandle ?? "o"}_${connection.target}`,
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const addBlock = useCallback(
    (type: string) => {
      const id = `${type}_${Date.now()}`;
      const maxX = nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
      const maxY = nodes.reduce((m, n) => Math.max(m, n.position.y), 120);
      const defaults: Record<string, Record<string, unknown>> = {
        trigger: { triggerType: "lead_created" },
        condition: { field: "name", operator: "contains", value: "" },
        wait: { unit: "days", amount: 1 },
        send_whatsapp_text: { message: "Olá {{nome}}!" },
        ai_classify: { mode: "lead_temperature" },
        distribute_lead: { method: "least_load", regionMappings: [], interestMappings: [] },
        create_callback: { delayHours: 2, note: "Retornar ligação" },
        make_call: { note: "Ligar para {{nome}}" },
        forward_call: { note: "Encaminhar chamada" },
        create_call_log: { title: "Chamada registrada pelo fluxo CRM" },
      };
      const newNode: Node<CrmNodeData> = {
        id,
        type: "crmBlock",
        position: { x: maxX + 280, y: selectedNodeId ? maxY : 80 },
        data: { blockType: type, blockData: defaults[type] ?? {} },
      };
      setNodes((nds) => [...nds, newNode]);
      if (selectedNodeId) {
        setEdges((eds) =>
          addEdge(
            {
              id: `e_${selectedNodeId}_${id}`,
              source: selectedNodeId,
              target: id,
              sourceHandle: nodes.find((n) => n.id === selectedNodeId)?.data.blockType === "condition" ? "yes" : undefined,
              type: "smoothstep",
              style: { stroke: "#2563eb", strokeWidth: 2 },
            },
            eds,
          ),
        );
      }
      setSelectedNodeId(id);
    },
    [nodes, selectedNodeId, setNodes, setEdges],
  );

  const updateSelectedData = (patch: Record<string, unknown>) => {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNodeId
          ? { ...n, data: { ...n.data, blockData: { ...n.data.blockData, ...patch } } }
          : n,
      ),
    );
  };

  const deleteSelected = () => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  };

  return (
    <div className="flex h-[min(72vh,720px)] min-h-[480px] overflow-hidden rounded-2xl border border-ink-200 dark:border-ink-700">
      <aside className="w-52 shrink-0 overflow-y-auto border-r border-ink-200 bg-white p-3 dark:border-ink-700 dark:bg-ink-950">
        {CRM_BLOCK_GROUPS.map((group) => (
          <div key={group.labelKey} className="mb-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
              {t(group.labelKey)}
            </p>
            <div className="flex flex-col gap-1">
              {group.blocks.map((b) => (
                <button
                  key={b.type}
                  type="button"
                  onClick={() => addBlock(b.type)}
                  className="rounded-lg border border-ink-200 px-2 py-1.5 text-left text-xs hover:bg-ink-50 dark:border-ink-600 dark:hover:bg-ink-900"
                >
                  {t(b.labelKey)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <div className="relative min-w-0 flex-1 bg-[#eef0f4] dark:bg-[#0d0f14]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => setSelectedNodeId(n.id)}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={16} />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      <aside className="w-64 shrink-0 overflow-y-auto border-l border-ink-200 bg-white p-3 dark:border-ink-700 dark:bg-ink-950">
        <p className="mb-2 text-xs font-semibold text-ink-700 dark:text-ink-200">{t("crmFlows.settingsTitle")}</p>
        {!selectedNode ? (
          <p className="text-xs text-ink-500">{t("crmFlows.selectNode")}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium">{t(`crmFlows.blockType.${selectedNode.data.blockType}`)}</p>
            {selectedNode.data.blockType === "trigger" ? (
              <label className="block text-xs">
                {t("crmFlows.fieldTrigger")}
                <input
                  className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                  value={String(selectedNode.data.blockData.triggerType ?? "")}
                  onChange={(e) => updateSelectedData({ triggerType: e.target.value })}
                />
              </label>
            ) : null}
            {selectedNode.data.blockType === "condition" ? (
              <>
                <label className="block text-xs">
                  {t("crmFlows.fieldField")}
                  <input
                    className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                    value={String(selectedNode.data.blockData.field ?? "")}
                    onChange={(e) => updateSelectedData({ field: e.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  {t("crmFlows.fieldOperator")}
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                    value={String(selectedNode.data.blockData.operator ?? "contains")}
                    onChange={(e) => updateSelectedData({ operator: e.target.value })}
                  >
                    <option value="eq">=</option>
                    <option value="neq">≠</option>
                    <option value="contains">{t("crmFlows.opContains")}</option>
                    <option value="gt">&gt;</option>
                    <option value="lt">&lt;</option>
                    <option value="empty">{t("crmFlows.opEmpty")}</option>
                  </select>
                </label>
                <label className="block text-xs">
                  {t("crmFlows.fieldValue")}
                  <input
                    className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                    value={String(selectedNode.data.blockData.value ?? "")}
                    onChange={(e) => updateSelectedData({ value: e.target.value })}
                  />
                </label>
              </>
            ) : null}
            {selectedNode.data.blockType === "send_whatsapp_text" ? (
              <label className="block text-xs">
                {t("crmFlows.fieldMessage")}
                <textarea
                  rows={4}
                  className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                  value={String(selectedNode.data.blockData.message ?? "")}
                  onChange={(e) => updateSelectedData({ message: e.target.value })}
                />
              </label>
            ) : null}
            {selectedNode.data.blockType === "remove_tag" ? (
              <label className="block text-xs">
                {t("crmFlows.fieldTag")}
                <select
                  className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                  value={String(selectedNode.data.blockData.tagId ?? "")}
                  onChange={(e) => updateSelectedData({ tagId: e.target.value })}
                >
                  <option value="">—</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedNode.data.blockType === "add_tag" ? (
              <label className="block text-xs">
                {t("crmFlows.fieldTag")}
                <select
                  className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                  value={String(selectedNode.data.blockData.tagId ?? "")}
                  onChange={(e) => updateSelectedData({ tagId: e.target.value })}
                >
                  <option value="">—</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedNode.data.blockType === "distribute_lead" ? (
              <>
                <label className="block text-xs">
                  {t("crmFlows.fieldDistributeMethod")}
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                    value={String(selectedNode.data.blockData.method ?? "least_load")}
                    onChange={(e) => updateSelectedData({ method: e.target.value })}
                  >
                    <option value="round_robin">{t("crmFlows.distributeRoundRobin")}</option>
                    <option value="least_load">{t("crmFlows.distributeLeastLoad")}</option>
                    <option value="by_region">{t("crmFlows.distributeByRegion")}</option>
                    <option value="by_interest">{t("crmFlows.distributeByInterest")}</option>
                  </select>
                </label>
                {selectedNode.data.blockData.method === "by_region" ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">{t("crmFlows.regionMappings")}</p>
                    {(
                      (selectedNode.data.blockData.regionMappings as { ddd: string; userId: string }[]) ??
                      []
                    ).map((row, idx) => (
                      <div key={idx} className="flex gap-1">
                        <input
                          className="w-14 rounded border px-1 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                          placeholder="DDD"
                          value={row.ddd}
                          onChange={(e) => {
                            const list = [
                              ...((selectedNode.data.blockData.regionMappings as {
                                ddd: string;
                                userId: string;
                              }[]) ?? []),
                            ];
                            list[idx] = { ...list[idx]!, ddd: e.target.value };
                            updateSelectedData({ regionMappings: list });
                          }}
                        />
                        <select
                          className="min-w-0 flex-1 rounded border px-1 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                          value={row.userId}
                          onChange={(e) => {
                            const list = [
                              ...((selectedNode.data.blockData.regionMappings as {
                                ddd: string;
                                userId: string;
                              }[]) ?? []),
                            ];
                            list[idx] = { ...list[idx]!, userId: e.target.value };
                            updateSelectedData({ regionMappings: list });
                          }}
                        >
                          <option value="">—</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-xs text-brand-600 hover:underline"
                      onClick={() =>
                        updateSelectedData({
                          regionMappings: [
                            ...((selectedNode.data.blockData.regionMappings as {
                              ddd: string;
                              userId: string;
                            }[]) ?? []),
                            { ddd: "", userId: "" },
                          ],
                        })
                      }
                    >
                      + {t("crmFlows.addMapping")}
                    </button>
                  </div>
                ) : null}
                {selectedNode.data.blockData.method === "by_interest" ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">{t("crmFlows.interestMappings")}</p>
                    {(
                      (selectedNode.data.blockData.interestMappings as {
                        interest: string;
                        userId: string;
                      }[]) ?? []
                    ).map((row, idx) => (
                      <div key={idx} className="flex gap-1">
                        <input
                          className="min-w-0 flex-1 rounded border px-1 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                          placeholder={t("crmFlows.interestKeyword")}
                          value={row.interest}
                          onChange={(e) => {
                            const list = [
                              ...((selectedNode.data.blockData.interestMappings as {
                                interest: string;
                                userId: string;
                              }[]) ?? []),
                            ];
                            list[idx] = { ...list[idx]!, interest: e.target.value };
                            updateSelectedData({ interestMappings: list });
                          }}
                        />
                        <select
                          className="min-w-0 flex-1 rounded border px-1 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                          value={row.userId}
                          onChange={(e) => {
                            const list = [
                              ...((selectedNode.data.blockData.interestMappings as {
                                interest: string;
                                userId: string;
                              }[]) ?? []),
                            ];
                            list[idx] = { ...list[idx]!, userId: e.target.value };
                            updateSelectedData({ interestMappings: list });
                          }}
                        >
                          <option value="">—</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-xs text-brand-600 hover:underline"
                      onClick={() =>
                        updateSelectedData({
                          interestMappings: [
                            ...((selectedNode.data.blockData.interestMappings as {
                              interest: string;
                              userId: string;
                            }[]) ?? []),
                            { interest: "", userId: "" },
                          ],
                        })
                      }
                    >
                      + {t("crmFlows.addMapping")}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
            {selectedNode.data.blockType === "create_callback" ? (
              <>
                <label className="block text-xs">
                  {t("crmFlows.fieldDelayHours")}
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                    value={Number(selectedNode.data.blockData.delayHours ?? 2)}
                    onChange={(e) => updateSelectedData({ delayHours: Number(e.target.value) })}
                  />
                </label>
                <label className="block text-xs">
                  {t("crmFlows.fieldNote")}
                  <textarea
                    rows={2}
                    className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                    value={String(selectedNode.data.blockData.note ?? "")}
                    onChange={(e) => updateSelectedData({ note: e.target.value })}
                  />
                </label>
              </>
            ) : null}
            {(selectedNode.data.blockType === "make_call" ||
              selectedNode.data.blockType === "forward_call") && (
              <label className="block text-xs">
                {t("crmFlows.fieldNote")}
                <textarea
                  rows={2}
                  className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                  value={String(selectedNode.data.blockData.note ?? "")}
                  onChange={(e) => updateSelectedData({ note: e.target.value })}
                />
              </label>
            )}
            {selectedNode.data.blockType === "create_call_log" ? (
              <label className="block text-xs">
                {t("crmFlows.fieldCallLogTitle")}
                <input
                  className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                  value={String(selectedNode.data.blockData.title ?? "")}
                  onChange={(e) => updateSelectedData({ title: e.target.value })}
                />
              </label>
            ) : null}
            {selectedNode.data.blockType === "assign_user" ? (
              <label className="block text-xs">
                {t("crmFlows.fieldUser")}
                <select
                  className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                  value={String(selectedNode.data.blockData.userId ?? "")}
                  onChange={(e) => updateSelectedData({ userId: e.target.value })}
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedNode.data.blockType === "wait" ? (
              <div className="flex gap-2">
                <label className="block flex-1 text-xs">
                  {t("crmFlows.fieldAmount")}
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                    value={Number(selectedNode.data.blockData.amount ?? 1)}
                    onChange={(e) => updateSelectedData({ amount: Number(e.target.value) })}
                  />
                </label>
                <label className="block flex-1 text-xs">
                  {t("crmFlows.fieldUnit")}
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 dark:border-ink-600 dark:bg-ink-900"
                    value={String(selectedNode.data.blockData.unit ?? "days")}
                    onChange={(e) => updateSelectedData({ unit: e.target.value })}
                  >
                    <option value="minutes">{t("crmFlows.unitMinutes")}</option>
                    <option value="hours">{t("crmFlows.unitHours")}</option>
                    <option value="days">{t("crmFlows.unitDays")}</option>
                  </select>
                </label>
              </div>
            ) : null}
            <button
              type="button"
              onClick={deleteSelected}
              className="text-xs text-rose-600 hover:underline"
            >
              {t("crmFlows.deleteNode")}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
