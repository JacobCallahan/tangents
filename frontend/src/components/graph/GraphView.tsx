/**
 * GraphView — renders the React Flow node graph for a chat.
 *
 * Layout rules:
 * - Main branch runs as a straight vertical line on the LEFT (column 0)
 * - Tangent branches extend downward to the RIGHT of their fork point
 * - Nodes are unlabelled selectable dots; branch-origin nodes are larger/accented
 * - Hovering a node shows a tooltip with its branch name(s)
 * - Clicking a node loads that node's linear history in the right pane
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node as RFNode,
  type Edge as RFEdge,
  MarkerType,
} from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import '@xyflow/react/dist/style.css';

import { chatsApi } from '../../api/chats';
import { useAppStore } from '../../store/appStore';
import { CommitDotNode } from './CommitDotNode';

const NODE_TYPES = { commitDotNode: CommitDotNode };

const COL_WIDTH = 70;
const ROW_HEIGHT = 70;

/**
 * Custom layout: main branch is column 0 (straight vertical line on the left).
 * Each tangent branch that diverges from any column gets its own column to the right.
 *
 * @param rfNodes    React Flow nodes (with data.parent_id available)
 * @param rfEdges    React Flow edges
 * @param mainNodeIds Set of node IDs that belong to the main branch ancestry
 */
function buildCustomLayout(
  rfNodes: RFNode[],
  rfEdges: RFEdge[],
  mainNodeIds: Set<string>,
): { nodes: RFNode[]; edges: RFEdge[] } {
  // Build children map keyed by source node id
  const childrenOf = new Map<string, string[]>();
  rfEdges.forEach((e) => {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
  });

  // Assign depths via BFS from roots (nodes with no incoming edge)
  const hasParent = new Set(rfEdges.map((e) => e.target));
  const roots = rfNodes.filter((n) => !hasParent.has(n.id));

  const depths = new Map<string, number>();
  const bfsQueue: Array<{ id: string; depth: number }> = roots.map((r) => ({
    id: r.id,
    depth: 0,
  }));
  while (bfsQueue.length > 0) {
    const { id, depth } = bfsQueue.shift()!;
    if (depths.has(id)) continue;
    depths.set(id, depth);
    (childrenOf.get(id) ?? []).forEach((child) =>
      bfsQueue.push({ id: child, depth: depth + 1 }),
    );
  }

  // Assign columns
  let nextCol = 1;
  const nodeColumns = new Map<string, number>();

  function assignCol(nodeId: string, col: number) {
    if (nodeColumns.has(nodeId)) return;
    nodeColumns.set(nodeId, col);

    const kids = childrenOf.get(nodeId) ?? [];
    const mainKids = kids.filter((id) => mainNodeIds.has(id));
    const otherKids = kids.filter((id) => !mainNodeIds.has(id));

    // Main-branch children always stay in column 0
    mainKids.forEach((id) => assignCol(id, 0));

    if (mainKids.length > 0 || col === 0) {
      // Diverging from the main branch (or another col 0 node): every non-main
      // child starts its own new column
      otherKids.forEach((id) => assignCol(id, nextCol++));
    } else {
      // Already in a tangent column: the first non-main child continues in the
      // same column (tangent continuation); further splits get new columns
      otherKids.forEach((id, idx) => {
        if (idx === 0) assignCol(id, col);
        else assignCol(id, nextCol++);
      });
    }
  }

  roots.forEach((r) => assignCol(r.id, 0));

  // Fallback: any node not yet assigned (disconnected sub-graphs, etc.)
  rfNodes.forEach((n) => {
    if (!nodeColumns.has(n.id)) nodeColumns.set(n.id, 0);
    if (!depths.has(n.id)) depths.set(n.id, 0);
  });

  return {
    nodes: rfNodes.map((n) => ({
      ...n,
      position: {
        x: (nodeColumns.get(n.id) ?? 0) * COL_WIDTH,
        y: (depths.get(n.id) ?? 0) * ROW_HEIGHT,
      },
    })),
    edges: rfEdges,
  };
}

/** Scrolls the viewport to fit the selected node and all its ancestors. */
function AutoScroller({ nodeIds }: { nodeIds: string[] }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!nodeIds.length) return;
    // Small delay so node positions are committed before we pan
    const timerId = setTimeout(() => {
      fitView({ nodes: nodeIds.map((id) => ({ id })), duration: 500, padding: 0.4 });
    }, 50);
    return () => clearTimeout(timerId);
  }, [nodeIds, fitView]);
  return null;
}

interface GraphViewProps {
  chatId: string;
}

function GraphViewInner({ chatId }: GraphViewProps) {
  const { setActiveNode, setActiveBranch, activeNodeId, activeBranchId, branches } = useAppStore();

  const { data: graphData } = useQuery({
    queryKey: ['graph', chatId],
    queryFn: () => chatsApi.getGraph(chatId),
  });

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    if (!graphData) return { nodes: [], edges: [] };

    // Find the "main" branch (named 'main', or the first branch as fallback)
    const mainBranch = branches.find((b) => b.name === 'main') ?? branches[0];

    // Walk ancestry of main branch head to compute mainNodeIds
    const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));
    const mainNodeIds = new Set<string>();
    let cur: string | null = mainBranch?.head_node_id ?? null;
    while (cur) {
      mainNodeIds.add(cur);
      cur = nodeById.get(cur)?.parent_id ?? null;
    }

    const rfNodes: RFNode[] = graphData.nodes.map((n) => ({
      id: n.id,
      type: 'commitDotNode',
      position: { x: 0, y: 0 },
      data: n as unknown as Record<string, unknown>,
      selectable: true,
    }));

    const rfEdges: RFEdge[] = [
      // Primary parent → child edges
      ...graphData.nodes
        .filter((n) => n.parent_id)
        .map((n) => ({
          id: `e-${n.parent_id}-${n.id}`,
          type: 'straight',
          source: n.parent_id!,
          target: n.id,
          animated: false,
          style: { stroke: '#404040', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#404040' },
        })),
      // Secondary merge-parent edges (thin dashed; only when origin still exists)
      ...graphData.nodes
        .filter((n) => n.merge_parent_id && rfNodes.some((r) => r.id === n.merge_parent_id))
        .map((n) => ({
          id: `em-${n.merge_parent_id}-${n.id}`,
          type: 'straight',
          source: n.merge_parent_id!,
          target: n.id,
          animated: false,
              style: { stroke: '#FF7F50', strokeWidth: 0.75, strokeDasharray: '3 6', opacity: 0.4 },
        })),
    ];

    return buildCustomLayout(rfNodes, rfEdges, mainNodeIds);
  }, [graphData, branches]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Derive the currently-selected node id and its full ancestor chain.
  const activeBranch = branches.find((b) => b.id === activeBranchId);
  const selectedId = activeNodeId ?? activeBranch?.head_node_id ?? null;

  // Ordered array: [selectedId, parentId, grandparentId, …, rootId]
  const ancestorNodeIds = useMemo(() => {
    if (!selectedId || !graphData) return selectedId ? [selectedId] : [];
    const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));
    const ids: string[] = [];
    let cur: string | null = selectedId;
    while (cur) {
      ids.push(cur);
      cur = nodeById.get(cur)?.parent_id ?? null;
    }
    return ids;
  }, [selectedId, graphData]);

  // Sync layout into React Flow state; mark the active node as selected
  // and colour the ancestor-path edges.
  useEffect(() => {
    // Edge IDs run source→target, i.e. parent→child. ancestorNodeIds is ordered
    // [child, parent, grandparent, …] so for index i: edge = `e-${ids[i+1]}-${ids[i]}`
    const ancestorEdgeIds = new Set(
      ancestorNodeIds.slice(1).map((parentId, i) => `e-${parentId}-${ancestorNodeIds[i]}`),
    );

    setNodes(layoutNodes.map((n) => ({ ...n, selected: n.id === selectedId })));
    setEdges(
      layoutEdges.map((e) =>
        ancestorEdgeIds.has(e.id)
          ? {
              ...e,
              style: { stroke: '#FBEC5D', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#FBEC5D' },
            }
          : {
              ...e,
              style: { stroke: '#404040', strokeWidth: 1.5 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#404040' },
            },
      ),
    );
  }, [layoutNodes, layoutEdges, ancestorNodeIds, selectedId, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      // Find the "owning" branch: among all branches whose ancestry includes
      // this node, pick the one with the shortest path from its HEAD to here
      // (most specific). This correctly resolves shared ancestor nodes to the
      // main branch and tangent-only nodes to their branch.
      if (graphData) {
        const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));
        let bestBranch = null;
        let bestDist = Infinity;
        for (const branch of branches) {
          let cur: string | null = branch.head_node_id;
          let dist = 0;
          while (cur) {
            if (cur === node.id) {
              if (dist < bestDist) { bestDist = dist; bestBranch = branch; }
              break;
            }
            cur = nodeById.get(cur)?.parent_id ?? null;
            dist++;
          }
        }
        if (bestBranch) setActiveBranch(bestBranch.id);
      }
      setActiveNode(node.id);
    },
    [setActiveNode, setActiveBranch, branches, graphData],
  );

  if (!graphData) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-600">
        Loading graph…
      </div>
    );
  }

  return (
    <div className="h-full w-full" style={{ minHeight: '300px' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#262626" gap={20} />
        <Controls showInteractive={false} />
        <AutoScroller nodeIds={ancestorNodeIds} />
      </ReactFlow>
    </div>
  );
}

export function GraphView({ chatId }: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphViewInner chatId={chatId} />
    </ReactFlowProvider>
  );
}

