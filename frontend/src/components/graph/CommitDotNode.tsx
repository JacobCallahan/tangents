/**
 * CommitDotNode — custom React Flow node rendered as a small dot.
 * Branch-head nodes are slightly larger; the selected node uses the
 * user-configurable highlight colour from the app store.
 * Summary/merge nodes are rendered in coral (#FF7F50).
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useAppStore } from '../../store/appStore';
import type { GraphNodeData } from '../../types';

type DotNodeData = GraphNodeData & { onClick?: () => void };

export function CommitDotNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as DotNodeData;
  const branchHeads = nodeData.branch_heads as string[];
  const isSummary = Boolean(nodeData.is_summary);
  const highlightColor = useAppStore((s) => s.highlightColor);

  // Nodes that are a branch HEAD are slightly larger for visibility
  const isBranchHead = branchHeads.length > 0;
  const size = isBranchHead ? 14 : 10;

  // Colour priority: selected → highlight; summary → coral; otherwise neutral
  const bg = selected ? highlightColor : isSummary ? '#FF7F50' : '#525252';

  return (
    <div
      title={branchHeads.length > 0 ? branchHeads.join(', ') : undefined}
      className="group relative flex cursor-pointer items-center justify-center"
      style={{ width: size, height: size }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <div
        data-testid="dot-circle"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: bg,
          boxShadow: selected ? `0 0 0 3px ${highlightColor}60` : undefined,
          transition: 'background-color 0.15s',
        }}
      />

      {/* Tooltip on hover */}
      {branchHeads.length > 0 && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 shadow group-hover:block">
          {branchHeads.join(', ')}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
