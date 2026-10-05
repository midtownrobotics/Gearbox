import { editorPlugin } from "./plugins/editor";
import { overviewPlugin } from "./plugins/overview";
import { signOffPlugin } from "./plugins/sign-off";
import { treesPlugin } from "./plugins/trees";

export const plugins = [overviewPlugin, treesPlugin, signOffPlugin, editorPlugin];
