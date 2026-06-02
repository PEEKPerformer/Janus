import React from "react";
import { render, fireEvent, screen } from "@testing-library/react-native";
import { CommentItem } from "../components/CommentItem";
import { mapLemmyComment, lid } from "../../sources/lemmy/mappers";
import { lemmyCommentsFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";
import { buildCommentTree } from "../../core/comment-tree";

const postId = lid("lemmy.world", "post", 1001);
const flat = lemmyCommentsFixture.comments.map((cv: unknown) => mapLemmyComment(cv, postId, "lemmy.world"));
const roots = buildCommentTree(flat); // [c10 (-> c11), c12]

describe("CommentItem", () => {
  it("renders the comment, author, OP badge, and nested reply", () => {
    render(<CommentItem node={roots[0]} />);
    expect(screen.getByText("OP top comment")).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("OP")).toBeTruthy();
    expect(screen.getByText("A reply")).toBeTruthy(); // child visible by default
  });

  it("collapses replies when the row is tapped", () => {
    render(<CommentItem node={roots[0]} />);
    fireEvent.press(screen.getByLabelText(/Comment by alice/));
    expect(screen.queryByText("A reply")).toBeNull(); // child hidden
    expect(screen.getByText("+1")).toBeTruthy(); // collapsed descendant count
  });
});
