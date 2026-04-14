# GitLab Diff Viewer - 代码差异查看器

基于 Web 的 GitLab 代码 Diff 查看工具，连接 GitLab 实例，对比分支当前状态与初始创建时的差异。

## 功能

- **GitLab 登录**：支持账号密码登录（OAuth2）和 Personal Access Token 登录
- **项目选择**：搜索并选择你有权限访问的 GitLab 项目
- **分支选择**：选择项目中的任意分支
- **Diff 对比**：展示所选分支与默认分支（merge-base）的代码差异
- **双栏视图**：左栏显示 Base（默认分支），右栏显示分支代码，差异行高亮
- **文件列表**：左侧展示所有变更文件，标注新增/修改/删除/重命名状态
- **零依赖**：不依赖任何第三方 npm 包

## 启动

```bash
node server.js
```

访问 http://localhost:3000

## 使用流程

1. 填写 GitLab 地址（默认 http://git.100credit.cn）
2. 使用账号密码或 Access Token 登录
3. 搜索并选择项目
4. 选择要查看的分支
5. 点击"对比"查看该分支相对默认分支的所有代码变更

## 技术栈

- **后端**: Node.js 内置 HTTP 模块，代理 GitLab API
- **Diff 解析**: 解析 GitLab Compare API 返回的 Unified Diff 格式
- **前端**: 原生 HTML/CSS/JavaScript，暗色主题
