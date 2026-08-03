/**
 * Product-level guidance for the model. This does not provide OS-level isolation:
 * LocalFilesystem containment and LocalSandbox are responsible for enforcement.
 */
export const PROJECT_WORKSPACE_POLICY = [
  '当前任务拥有项目工作目录。只读取、编辑、创建和执行当前项目根目录内的文件；',
  '不要使用绝对路径访问项目目录以外的位置。执行命令前确认它们的副作用。',
].join('\n')
