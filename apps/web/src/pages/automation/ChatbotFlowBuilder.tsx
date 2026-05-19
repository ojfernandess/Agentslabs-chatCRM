import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useI18n } from "@/i18n/I18nProvider";
import { ChatbotBlockPalette } from "./ChatbotBlockPalette";
import { ChatbotBlockSettingsPanel } from "./ChatbotBlockSettingsPanel";
import { ChatbotFlowNodeCard, type ChatbotFlowNodeData } from "./ChatbotFlowNodeCard";
import type { ChatbotFlowDefinition, ChatbotFlowNode } from "./chatbotFlowTypes";

const nodeTypes = { chatbotBlock: ChatbotFlowNodeCard };

function flowToRf(flow: ChatbotFlowDefinition): { nodes: Node<ChatbotFlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<ChatbotFlowNodeData>[] = flow.nodes.map((n) => ({
    id: n.id,
    type: "chatbotBlock",
    position: n.position ?? { x: 0, y: 0 },
    data: { blockType: n.type, blockData: n.data ?? {} },
  }));
  const edges: Edge[] = flow.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.branch === "yes" ? "yes" : e.branch === "no" ? "no" : undefined,
    type: "smoothstep",
    animated: false,
    style: { stroke: "#ff6b2c", strokeWidth: 2 },
  }));
  return { nodes, edges };
}

function rfToFlow(nodes: Node<ChatbotFlowNodeData>[], edges: Edge[]): ChatbotFlowDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.blockType,
      position: n.position,
      data: n.data.blockData ?? {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      branch:
        e.sourceHandle === "yes" ? "yes" : e.sourceHandle === "no" ? "no" : undefined,
    })),
  };
}

interface Props {
  value: ChatbotFlowDefinition;
  onChange: (flow: ChatbotFlowDefinition) => void;
}

export function ChatbotFlowBuilder({ value, onChange }: Props) {
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

  const selectedFlowNode: ChatbotFlowNode | null = useMemo(() => {
    const n = nodes.find((x) => x.id === selectedNodeId);
    if (!n) return null;
    return {
      id: n.id,
      type: n.data.blockType,
      position: n.position,
      data: n.data.blockData,
    };
  }, [nodes, selectedNodeId]);

  const flowNodesForSettings = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: n.data.blockType,
        position: n.position,
        data: n.data.blockData,
      })),
    [nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "smoothstep",
            style: { stroke: "#ff6b2c", strokeWidth: 2 },
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
      const newNode: Node<ChatbotFlowNodeData> = {
        id,
        type: "chatbotBlock",
        position: { x: maxX + 320, y: selectedNodeId ? maxY : 80 },
        data: { blockType: type, blockData: {} },
      };
      setNodes((nds) => [...nds, newNode]);
      if (selectedNodeId) {
        const sourceNode = nodes.find((n) => n.id === selectedNodeId);
        const sourceHandle =
          sourceNode?.data.blockType === "condition" ? "yes" : undefined;
        setEdges((eds) =>
          addEdge(
            {
              id: `e_${selectedNodeId}_${id}`,
              source: selectedNodeId,
              target: id,
              sourceHandle,
              type: "smoothstep",
              style: { stroke: "#ff6b2c", strokeWidth: 2 },
            },
            eds,
          ),
        );
      }
      setSelectedNodeId(id);
    },
    [nodes, selectedNodeId, setNodes, setEdges],
  );

  const updateNodeData = useCallback(
    (id: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, blockData: data } } : n,
        ),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [setNodes, setEdges, selectedNodeId],
  );

  return (
    <div className="typebot-editor flex h-[min(72vh,720px)] min-h-[480px] overflow-hidden rounded-2xl border border-ink-200 shadow-inner dark:border-ink-700">
      <ChatbotBlockPalette onAddBlock={addBlock} />

      <div className="relative min-w-0 flex-1 bg-[#eef0f4] dark:bg-[#0d0f14]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedNodeId(n.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.25}
          maxZoom={1.5}
          defaultEdgeOptions={{ type: "smoothstep" }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#c5cad3" />
          <Controls
            showInteractive={false}
            className="!rounded-xl !border-ink-200 !bg-white !shadow-md dark:!border-ink-700 dark:!bg-ink-900"
          />
          <MiniMap
            nodeColor={(n) => {
              const t = (n.data as ChatbotFlowNodeData)?.blockType;
              if (t === "text" || t === "image") return "#2563eb";
              if (t === "text_input" || t === "choice_input") return "#ea580c";
              if (t === "condition" || t === "set_variable") return "#7c3aed";
              return "#64748b";
            }}
            className="!rounded-xl !border !border-ink-200 !bg-white/90 dark:!border-ink-700 dark:!bg-ink-900/90"
          />
          <Panel position="top-center" className="!m-2">
            <span className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-medium text-ink-500 shadow-sm backdrop-blur dark:bg-ink-900/90 dark:text-ink-400">
              {t("chatbotPage.canvasHint")}
            </span>
          </Panel>
        </ReactFlow>
      </div>

      <ChatbotBlockSettingsPanel
        node={selectedFlowNode}
        allNodes={flowNodesForSettings}
        onUpdate={updateNodeData}
        onDelete={deleteNode}
      />
    </div>
  );
}
