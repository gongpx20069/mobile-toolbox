# Mobile Toolbox

一个用于放置手机端小工具和看板的静态站点集合。当前包含美股持仓看板，后续可以继续在 `apps/` 下添加新功能。

## 应用

| 应用 | 路径 | 说明 |
| --- | --- | --- |
| 美股持仓看板 | `apps/stock-portfolio/` | 横屏常亮展示美股持仓、市值、盈亏和日内变动 |

## 使用

在仓库根目录启动本地静态服务：

```powershell
python -m http.server 5173
```

然后打开入口页：

```text
http://localhost:5173
```

也可以直接打开美股持仓看板：

```text
http://localhost:5173/apps/stock-portfolio/
```

手机和电脑在同一个局域网时，也可以用电脑的局域网 IP 访问，例如：

```text
http://192.168.1.10:5173
```

## 部署

仓库已包含 GitHub Pages 工作流。推送到 `main` 后，会部署到：

```text
https://gongpx20069.github.io/mobile-toolbox/
```

## 美股持仓看板功能

- 手动添加 / 更新持仓：股票代码、数量、成本价
- 本地浏览器保存持仓，不上传券商账号或密码
- 展示总市值、总成本、持仓盈亏、日内变动
- 每 60 秒自动刷新腾讯美股行情
- 支持添加到手机主屏幕作为 PWA 使用
- 支持浏览器 Screen Wake Lock API 时可开启网页常亮

## 注意

- PWA 和 Service Worker 需要通过 `http://localhost`、局域网 HTTP 或 HTTPS 访问，直接双击打开 HTML 时无法完整启用。
- iPhone 对网页常亮限制较多；Android Chrome 的 PWA 和常亮支持通常更好。
- 本项目只适合个人看板使用，不构成投资建议。
