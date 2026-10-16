import type { Plugin } from "../../shared/plugin-types";
import { EditorPage } from "./editor-page";
import { TreeEditorPage } from "./tree-editor-page";

export const editorPlugin: Plugin = {
  name: "editor",
  routes: [
    { path: "/edit", element: <EditorPage /> },
    { path: "/edit/:treeId", element: <TreeEditorPage /> },
  ],
  navItems: [{ label: "Edit Trees", to: "/edit", order: 40, mentorOnly: true }],
};
