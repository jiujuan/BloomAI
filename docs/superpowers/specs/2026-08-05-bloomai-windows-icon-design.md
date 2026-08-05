# BloomAI Windows 桌面图标设计

## 背景

BloomAI 当前为 Electron 桌面应用。项目没有配置 Windows 安装包图标，主窗口没有指定应用图标，托盘图标使用 `nativeImage.createEmpty()`，因此 Windows 桌面、任务栏或托盘可能显示为空白图标。

## 目标

- 为 BloomAI 建立稳定、可识别的 Windows 应用图标。
- 生成带多尺寸图像的 `.ico`，覆盖 Windows 桌面、任务栏、文件资源管理器和高 DPI 场景。
- 让 Electron 主窗口、托盘和 electron-builder Windows 安装包统一使用同一图标。
- 保留可编辑的 SVG/PNG 源文件，便于后续品牌迭代。

## 已确认的视觉方向

采用 **A · Bloom Orb**：

- 深海军蓝圆角方形底。
- 青绿色到蓝紫色的渐变光球。
- 中央白色花蕊/火焰形高光，表达 Bloom 与 AI 的结合。
- 右上角小型高光点，增强发光和智能感。
- 图标内部不放文字，保证 16–48 px 下仍然清晰。

## 资源方案

建议新增以下资源：

- `public/icons/bloomai-icon.svg`：矢量源文件。
- `public/icons/bloomai-icon.png`：256 px PNG 预览/备用资源。
- `public/icons/bloomai.ico`：Windows 多尺寸图标，包含 16、24、32、48、64、128、256 px。

资源放置在 `public` 下，使 Vite 构建时复制到 `dist/icons`，生产环境可通过 `app.getAppPath()` 定位，开发环境可直接从项目根目录的 `public/icons` 定位。

## Electron 接入

在 `src/main/index.ts` 中：

- 增加统一的图标路径解析函数，区分开发环境和打包环境。
- 为主 `BrowserWindow` 设置 `icon`。
- 托盘使用 `nativeImage.createFromPath(...)`，替换空图标。
- 图标加载失败时保留安全降级，避免应用启动失败。

在 `package.json` 的 electron-builder 配置中：

- 设置 Windows `win.icon` 指向 `public/icons/bloomai.ico`。
- 不增加额外运行时依赖；图标随现有 `dist/**/*` 文件规则进入安装包。

## 验证标准

- TypeScript 检查通过。
- Vite/Electron 构建通过。
- 构建产物中存在 `dist/icons/bloomai.ico`。
- 主进程产物能够解析开发和生产两种图标路径。
- Windows 图标文件包含预期的多尺寸目录，避免单一低分辨率图像被拉伸。
- 不修改仓库中与本任务无关的既有未提交改动。

## 非目标

- 本次不改变 BloomAI 应用内 UI logo、网站 favicon 或品牌色系统。
- 本次不制作 macOS `.icns` 或 Linux 桌面图标。
- 本次不引入图标编辑器或新的运行时包。
