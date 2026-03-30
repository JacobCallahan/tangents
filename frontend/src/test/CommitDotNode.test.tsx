/**
 * CommitDotNode tests.
 * Verifies that the selected state and store highlight colour drive styling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { CommitDotNode } from '../components/graph/CommitDotNode';
import { useAppStore } from '../store/appStore';
import { resetStore } from './utils';

// CommitDotNode uses NodeProps from @xyflow/react — supply the minimum required shape.
function makeProps(overrides: {
  id?: string;
  selected?: boolean;
  branchHeads?: string[];
  isSummary?: boolean;
}) {
  return {
    id: overrides.id ?? 'node-1',
    type: 'commitDotNode',
    selected: overrides.selected ?? false,
    dragging: false,
    deletable: false,
    selectable: true,
    draggable: false,
    isConnectable: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      branch_heads: overrides.branchHeads ?? [],
      is_summary: overrides.isSummary ?? false,
    },
  };
}

/** Find the inner circle <div> via its test id. */
function getCircle(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="dot-circle"]') as HTMLElement;
}

// @xyflow/react Handle component needs a provider — mock it to a no-op span.
vi.mock('@xyflow/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...mod,
    Handle: () => null,
  };
});

beforeEach(() => {
  resetStore();
});

describe('CommitDotNode', () => {
  it('uses a neutral background when not selected', () => {
    const { container } = render(
      <CommitDotNode {...(makeProps({ selected: false }) as Parameters<typeof CommitDotNode>[0])} />,
    );
    const dot = getCircle(container);
    // jsdom normalises hex colours to rgb()
    expect(dot.style.backgroundColor).toBe('rgb(82, 82, 82)');
  });

  it('uses the store highlight colour when selected', () => {
    useAppStore.setState({ highlightColor: '#ff0000' });
    const { container } = render(
      <CommitDotNode {...(makeProps({ selected: true }) as Parameters<typeof CommitDotNode>[0])} />,
    );
    const dot = getCircle(container);
    expect(dot.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('adds a box-shadow glow when selected', () => {
    useAppStore.setState({ highlightColor: '#ff0000' });
    const { container } = render(
      <CommitDotNode {...(makeProps({ selected: true }) as Parameters<typeof CommitDotNode>[0])} />,
    );
    const dot = getCircle(container);
    expect(dot.style.boxShadow).toContain('#ff0000');
  });

  it('shows no box-shadow when not selected', () => {
    const { container } = render(
      <CommitDotNode {...(makeProps({ selected: false }) as Parameters<typeof CommitDotNode>[0])} />,
    );
    const dot = getCircle(container);
    expect(dot.style.boxShadow).toBe('');
  });

  it('renders a larger dot for branch-head nodes', () => {
    const { container: headContainer } = render(
      <CommitDotNode
        {...(makeProps({ branchHeads: ['main'] }) as Parameters<typeof CommitDotNode>[0])}
      />,
    );
    const { container: nonHeadContainer } = render(
      <CommitDotNode
        {...(makeProps({ branchHeads: [] }) as Parameters<typeof CommitDotNode>[0])}
      />,
    );

    const headOuter = headContainer.querySelector('div') as HTMLElement;
    const nonHeadOuter = nonHeadContainer.querySelector('div') as HTMLElement;

    const headSize = parseInt(headOuter.style.width);
    const nonHeadSize = parseInt(nonHeadOuter.style.width);
    expect(headSize).toBeGreaterThan(nonHeadSize);
  });

  it('shows a tooltip with the branch name for head nodes', () => {
    const { getByTitle } = render(
      <CommitDotNode
        {...(makeProps({ branchHeads: ['main'] }) as Parameters<typeof CommitDotNode>[0])}
      />,
    );
    expect(getByTitle('main')).toBeInTheDocument();
  });

  it('adopts the new highlight colour when the store updates', () => {
    useAppStore.setState({ highlightColor: '#FF7F50' });
    const { container } = render(
      <CommitDotNode {...(makeProps({ selected: true }) as Parameters<typeof CommitDotNode>[0])} />,
    );
    act(() => {
      useAppStore.setState({ highlightColor: '#00ff00' });
    });
    const dot = getCircle(container);
    expect(dot.style.backgroundColor).toBe('rgb(0, 255, 0)');
  });

  it('uses coral (#FF7F50) background for summary nodes when not selected', () => {
    const { container } = render(
      <CommitDotNode
        {...(makeProps({ selected: false, isSummary: true }) as Parameters<typeof CommitDotNode>[0])}
      />,
    );
    const dot = getCircle(container);
    // #FF7F50 → rgb(255, 127, 80)
    expect(dot.style.backgroundColor).toBe('rgb(255, 127, 80)');
  });

  it('uses highlight colour for selected summary node (selection takes priority)', () => {
    useAppStore.setState({ highlightColor: '#ff0000' });
    const { container } = render(
      <CommitDotNode
        {...(makeProps({ selected: true, isSummary: true }) as Parameters<typeof CommitDotNode>[0])}
      />,
    );
    const dot = getCircle(container);
    expect(dot.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });
});
