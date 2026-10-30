// 工具清单：给 QQ / 微信这类桥接做白名单用，不用再按名字一个个打补丁。
//   import { READ_TOOLS, WRITE_TOOLS } from 'dsh-bili-eyes/tool-list';
// 只读的工具群聊里放开也安全（返回的都是公开内容）；写工具受插件自己的档位、额度和门卫约束，
// 桥接要不要在群聊里放开它们，由桥接决定。
export const READ_TOOLS = Object.freeze(['bili_look', 'bili_look_zoom', 'bili_find', 'bili_feed', 'bili_comments', 'bili_surf', 'bili_inbox']);
export const WRITE_TOOLS = Object.freeze(['bili_like', 'bili_fav', 'bili_comment', 'bili_dm', 'bili_post', 'bili_follow', 'bili_confirm']);
export const ALL_TOOLS = Object.freeze([...READ_TOOLS, ...WRITE_TOOLS]);
