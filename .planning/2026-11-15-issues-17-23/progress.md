# Progress: issues #17–#23

## 2026-11-15 会话 1
- 新建计划 `2026-11-15-issues-17-23`（`init-session.sh`；`.active_plan` 指向它）。
- 读取 7 个 open issue（#17–#23），摘要写入 findings.md。
- Explore agent 定位相关代码，结果写入 findings.md「代码调研」。
- 写出 task_plan.md：J.A–J.E 五个阶段，待决定事项 D1–D7。
- 下一步：等待 HU 确认 D1–D7。
- HU 确认：D1、D2、D3、D7 选推荐项；D4–D6 按推荐默认。J.0 完成，下一步 J.A。

## 2026-11-15 会话 1（续）：J.A
- 分支 `fix/install-versions`。
- #23：native 改从 `expo` 导入，peer 改 `expo`；expo-doctor 修前 19/20 → 修后 20/20；iOS e2e bundle 导出成功。
- #17：复现根因（pnpm 内置 minimumReleaseAge 24h ⇒ bare add 得 0.1.0）；init 按 CLI 版本安装 + 读回校验；doctor 版本一致性 + scripts 命令检查；真实 npm 安装验证通过。
- 文档三语：cli.mdx、troubleshooting.mdx。
- 错误：一次文档替换误删 zh 标题，已恢复（见 task_plan Errors）。
- `pnpm check` exit 0（828 tests）；docs:check 通过。
- 下一步：等 HU 确认提交 / PR，然后 J.B。

## 2026-11-15 会话 1（续）：J.A 提交、J.B
- J.A 提交（c7c9c43 + dd8c49b），PR #24。
- J.B 分支 `fix/scaffold`（叠在 J.A 上）。
- 发现：缺 QuiescoRoot ⇒ agent 不连接（不只是软重置），doctor 改为一律 fail（D2 修正）。
- #20 init 自动包裹 `registerRootComponent(App)`；doctor 搜索入口与其注册的组件。
- #21 init 改 tsconfig、support 注释、driver-pattern 文档新节；实测中发现并修复 `registerQuiesco({ world })` 的 TS2419。
- 实测：web 计数器 3/3；去掉包裹 ⇒ CONNECT_TIMEOUT；dry-run 能报两类错误。
- `pnpm check` exit 0（834 tests）。下一步：HU 确认提交 / PR，然后 J.C。

## 2026-11-15 会话 1（续）：J.B 提交、J.C
- J.B 提交（081380d + 3dd235d），PR #25（base fix/install-versions）。
- J.C 分支 `fix/diagnostics`（叠在 J.B 上）。
- #19：复用 Metro 经 env 告知 runner；bundle 未知时按原因给文案 + warn。
- #22：Driver / Session / QuiescoWorld 的 `platform`。
- 实测中发现 `init --packages` 的 pnpm overrides 写错位置（pnpm 10+ 不读 package.json 的 pnpm 字段），已修。
- 实测 A / B 场景与 platform 均符合预期。`pnpm check` exit 0（838 tests）。
