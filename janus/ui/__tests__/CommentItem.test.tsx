import React from "react";
import { render, fireEvent, screen } from "@testing-library/react-native";
import { CommentItem } from "../components/CommentItem";
import { mapLemmyComment, lid } from "../../sources/lemmy/mappers";
import { lemmyCommentsFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";
import { buildCommentTree, flattenVisible } from "../../core/comment-tree";

const postId = lid("lemmy.world", "post", 1001);
const flat = lemmyCommentsFixture.comments.map((cv: unknown) =>
  mapLemmyComment(cv, postId, "lemmy.world"),
);
const roots = buildCommentTree(flat); // [c10 (-> c11), c12]
const visible = flattenVisible(roots, new Set()); // c10(d0), c11(d1), c12(d0)
const rootRow = visible[0]; // c10: OP, hasChildren, descendantCount 1

describe("CommentItem (single virtualized row)", () => {
  it("renders the comment, author and OP badge", () => {
    render(<CommentItem item={rootRow} onToggle={() => {}} />);
    expect(screen.getByText("OP top comment")).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("OP")).toBeTruthy();
  });

  it("calls onToggle with the comment id when tapped", () => {
    const onToggle = jest.fn();
    render(<CommentItem item={rootRow} onToggle={onToggle} />);
    fireEvent.press(screen.getByLabelText(/Comment by alice/));
    expect(onToggle).toHaveBeenCalledWith(rootRow.comment.id);
  });

  it("shows +N and hides the body when collapsed", () => {
    const collapsedRow = flattenVisible(
      roots,
      new Set([rootRow.comment.id]),
    )[0];
    render(<CommentItem item={collapsedRow} onToggle={() => {}} />);
    expect(screen.getByText("+1")).toBeTruthy(); // c10 has 1 descendant (c11)
    expect(screen.queryByText("OP top comment")).toBeNull();
  });

  it("shows the NEW badge for comments since the last visit", () => {
    render(<CommentItem item={rootRow} onToggle={() => {}} isNew />);
    expect(screen.getByText("NEW")).toBeTruthy();
  });

  it("renders the author's local tag and routes author taps", () => {
    const onAuthorPress = jest.fn();
    const onAuthorLongPress = jest.fn();
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        tag={{ label: "GPU expert", color: "#8b7cff" }}
        onAuthorPress={onAuthorPress}
        onAuthorLongPress={onAuthorLongPress}
      />,
    );
    expect(screen.getByText("GPU expert")).toBeTruthy();
    const author = screen.getByLabelText(/alice. Tap for profile/);
    fireEvent.press(author);
    expect(onAuthorPress).toHaveBeenCalledWith(rootRow.comment);
    fireEvent(author, "longPress");
    expect(onAuthorLongPress).toHaveBeenCalledWith(rootRow.comment);
  });
});

describe("CommentItem + AI Lens treatments", () => {
  const aiV = { index: 3, confidence: 0.92 };

  it("renders the verdict chip and routes chip taps to the detail handler", () => {
    const onPressAiChip = jest.fn();
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        aiVerdict={aiV}
        aiTreatment="label"
        onPressAiChip={onPressAiChip}
      />,
    );
    expect(screen.getByText("AI-written")).toBeTruthy();
    expect(screen.getByText("OP top comment")).toBeTruthy(); // label never veils
    fireEvent.press(screen.getByLabelText(/AI Lens: likely AI-written/));
    expect(onPressAiChip).toHaveBeenCalledWith(rootRow.comment);
  });

  it("collapse folds the body behind a reasoned stub; tapping reveals", () => {
    const onRevealAi = jest.fn();
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        onReply={() => {}}
        aiVerdict={aiV}
        aiTreatment="collapse"
        onRevealAi={onRevealAi}
      />,
    );
    expect(screen.queryByText("OP top comment")).toBeNull();
    expect(screen.queryByLabelText(/Reply to alice/)).toBeNull(); // actions fold too
    const stub = screen.getByLabelText(/folded by AI Lens/i);
    fireEvent.press(stub);
    expect(onRevealAi).toHaveBeenCalledWith(rootRow.comment);
  });

  it("revealed comments render fully, chip still on", () => {
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        aiVerdict={aiV}
        aiTreatment="hide"
        aiRevealed
      />,
    );
    expect(screen.getByText("OP top comment")).toBeTruthy();
    expect(screen.getByText("AI-written")).toBeTruthy();
  });

  it("hide uses the hidden wording and dim keeps the body visible", () => {
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        aiVerdict={aiV}
        aiTreatment="hide"
      />,
    );
    expect(screen.getByLabelText(/hidden by AI Lens/i)).toBeTruthy();
    screen.unmount();
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        aiVerdict={aiV}
        aiTreatment="dim"
      />,
    );
    expect(screen.getByText("OP top comment")).toBeTruthy();
  });

  it("opt-in human chip renders even though human carries treatment 'none'", () => {
    // The real app passes treatmentFor()'s result, which is always "none" for
    // a human verdict. The chip must still show — it's gated on showHuman, not
    // on the (always-none) treatment.
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        aiVerdict={{ index: 0, confidence: 0.95 }}
        aiTreatment="none"
        showHumanChip
      />,
    );
    expect(screen.getByText("human")).toBeTruthy();
    expect(screen.getByText("OP top comment")).toBeTruthy(); // never veils
  });

  it("human verdicts never chip or veil; transient status lines render", () => {
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        aiVerdict={{ index: 0, confidence: 0.97 }}
        aiTreatment="hide"
        aiStatus="Checking…"
      />,
    );
    expect(screen.getByText("OP top comment")).toBeTruthy();
    expect(screen.queryByText(/AI-written/)).toBeNull();
    expect(screen.getByText("Checking…")).toBeTruthy();
  });

  it("judged-human comments keep a quiet persistent marker (detail on tap)", () => {
    const onPressAiChip = jest.fn();
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        onReply={() => {}}
        onCheckWriting={() => {}}
        aiVerdict={{ index: 0, confidence: 0.93 }}
        onPressAiChip={onPressAiChip}
      />,
    );
    // The verdict survives as "human" instead of evaporating; AI? is gone.
    expect(screen.queryByText("AI?")).toBeNull();
    fireEvent.press(screen.getByText("human"));
    expect(onPressAiChip).toHaveBeenCalledWith(rootRow.comment);
  });

  it("hides the manual AI? button on a comment too short to judge", () => {
    // "OP top comment" is well under MIN_BODY_CHARS, so the detector would
    // refuse it — don't offer the check (this is the forward-mode annoyance).
    render(
      <CommentItem
        item={rootRow}
        onToggle={() => {}}
        onReply={() => {}}
        onCheckWriting={() => {}}
      />,
    );
    expect(screen.queryByText("AI?")).toBeNull();
  });

  it("offers the manual AI? button once the comment is long enough", () => {
    const longRow = {
      ...rootRow,
      comment: { ...rootRow.comment, body: { text: "word ".repeat(60) } },
    };
    render(
      <CommentItem
        item={longRow}
        onToggle={() => {}}
        onReply={() => {}}
        onCheckWriting={() => {}}
      />,
    );
    expect(screen.getByText("AI?")).toBeTruthy();
  });
});
