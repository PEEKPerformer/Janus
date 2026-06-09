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
