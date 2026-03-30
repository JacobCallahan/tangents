"""
Context compression service.

When a branch's linear history exceeds the model's context window budget,
the oldest N nodes are summarised into a single "compression node" that
replaces them in the chain — keeping the window within budget while retaining
semantic context.

Strategy (spec §3.4):
  1. Fetch the linear history up to the branch head.
  2. Estimate total token count.
  3. If tokens > budget, take the oldest half of nodes and summarise them via
     a short LiteLLM call.
  4. Create a new "compression" node whose:
       - parent_id  = the parent of the first compressed node (or NULL)
       - user_prompt = "[Compressed history]"
       - ai_response = the summary text
       - model_used  = the compression model
  5. Re-parent the first non-compressed node to point at the new compression node.
  6. Delete the now-orphaned compressed nodes (they are exclusively owned by
     this branch since no other branch can reference them without going
     through the branch head).

Returns the new compression node ID, or None if no compression was needed.
"""

from __future__ import annotations

import logging

import litellm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Branch, Node
from app.services.history import count_messages_tokens, fetch_linear_history, format_history_for_llm

logger = logging.getLogger(__name__)

# Compression is triggered when the estimated token count exceeds this fraction
# of the model's context window.  0.75 = trigger at 75% capacity.
_COMPRESSION_THRESHOLD = 0.75

# The oldest fraction of history to compress when triggered.
_COMPRESS_OLDEST_FRACTION = 0.5


async def maybe_compress_context(
    branch: Branch,
    model: str,
    context_window_tokens: int,
    db: AsyncSession,
) -> str | None:
    """
    Check if the branch history is above the compression threshold and, if so,
    summarise the oldest half.  Returns the new compression node ID on success,
    or None if no compression was needed or compression failed.
    """
    history = await fetch_linear_history(db, branch.head_node_id)
    if len(history) < 4:  # Not worth compressing tiny histories
        return None

    messages = await format_history_for_llm(history)
    total_tokens = count_messages_tokens(messages)
    threshold = int(context_window_tokens * _COMPRESSION_THRESHOLD)

    if total_tokens <= threshold:
        return None  # Within budget — nothing to do

    # Determine how many nodes to compress
    n_to_compress = max(1, int(len(history) * _COMPRESS_OLDEST_FRACTION))
    to_compress = history[:n_to_compress]
    remainder = history[n_to_compress:]

    if not remainder:
        return None  # Can't compress the entire history (nothing left to re-parent to)

    logger.info(
        "Compressing %d/%d nodes for branch %s (estimated %d tokens, threshold %d)",
        n_to_compress, len(history), branch.id, total_tokens, threshold,
    )

    # Build the compression prompt
    raw = "\n\n".join(
        f"User: {n['user_prompt']}\nAssistant: {n.get('ai_response', '[no response]')}"
        for n in to_compress
    )
    prompt = (
        "The following is the beginning of a conversation that is now being "
        "compressed to save context space. Summarise the key information, "
        "decisions, and code from this portion so a language model can "
        "continue the conversation without losing important context.\n\n"
        + raw
    )

    try:
        response = await litellm.acompletion(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=min(1024, context_window_tokens // 4),
            stream=False,
        )
        summary = response.choices[0].message.content or ""
    except Exception as exc:  # noqa: BLE001
        logger.warning("Context compression failed: %s", exc)
        return None

    # The first compressed node's parent becomes the compression node's parent
    first_compressed_parent = to_compress[0].get("parent_id")

    # Create the compression node (marked as summary so future history queries
    # treat it as a context root and do not recurse above it).
    compression_node = Node(
        chat_id=branch.head_node_id and history[0]["chat_id"],
        parent_id=first_compressed_parent,
        user_prompt="[Compressed history]",
        ai_response=summary,
        model_used=model,
        is_summary=True,
    )
    db.add(compression_node)
    await db.flush()

    # Re-parent the first non-compressed node to the compression node
    first_remaining_id = remainder[0]["id"]
    result = await db.execute(select(Node).where(Node.id == first_remaining_id))
    first_remaining = result.scalar_one()
    first_remaining.parent_id = compression_node.id

    # Delete the compressed nodes (leaves → root order to satisfy FK constraints)
    for node_dict in reversed(to_compress):
        result = await db.execute(select(Node).where(Node.id == node_dict["id"]))
        node = result.scalar_one_or_none()
        if node:
            await db.delete(node)

    await db.flush()
    logger.info("Compression complete → new node %s", compression_node.id)
    return compression_node.id
