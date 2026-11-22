# RollCall 生产环境部署指南（Ubuntu + Nginx）

本文以 Ubuntu 22.04 + Nginx + systemd 为例，介绍如何把 RollCall 从本地开发环境部署到云服务器，使手机、平板和其他电脑都能通过公网访问。

技术栈回顾：

- 前端：React + Vite
- 后端：FastAPI + Uvicorn
- 数据库：SQLite
- 认证：密码登录后生成会话 Token

## 1. 总体架构

开发脚本 `start.ps1` 会启动 Vite 开发服务器（端口 `5173`）和 FastAPI 开发服务（端口 `8000`），它依赖 Vite 的开发代理转发 `/api` 请求，且后端只监听本机地址并带自动重载，不适合生产环境。生产环境采用：

```text
浏览器
   │
   ▼
Nginx（公网 80/443 端口）
   ├── 前端：/opt/rollcall/frontend/dist
   └── /api 请求 → 127.0.0.1:8000
                         │
                         ▼
                    FastAPI/Uvicorn
                         │
                         ▼
              SQLite：attendance.db
```

Nginx 只负责对外提供网页和反向代理，FastAPI 只在服务器内部监听 `127.0.0.1:8000`，后端端口不直接暴露。

## 2. 准备服务器

- 一台 Ubuntu 22.04 云服务器（2 vCPU / 2 GiB 内存已足够）
- 安装基础软件：

```bash
sudo apt update
sudo apt install -y python3-venv nginx sqlite3
```

建议使用 SSH 公钥登录而不是传递密码：把本机公钥追加到服务器的 `~/.ssh/authorized_keys`，私钥妥善保存在本机。

## 3. 上传代码并构建前端

前端需要先在本地（或服务器上）构建生产文件：

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
```

构建成功后生成 `frontend/dist`。随后把后端代码和前端构建结果上传到服务器：

```bash
scp -r backend user@your-server-ip:/home/user/rollcall-upload/
scp -r frontend/dist user@your-server-ip:/home/user/rollcall-upload/frontend/
```

服务器正式目录建议为：

```text
/opt/rollcall/backend
/opt/rollcall/frontend/dist
/opt/rollcall/venv
```

## 4. 安装 Python 环境和依赖

```bash
sudo python3 -m venv /opt/rollcall/venv
sudo /opt/rollcall/venv/bin/pip install -r /opt/rollcall/backend/requirements.txt
```

虚拟环境的作用是隔离项目依赖，避免和系统中其他 Python 程序发生版本冲突。

## 5. 配置 systemd 常驻服务

创建 `/etc/systemd/system/rollcall.service`：

```ini
[Unit]
Description=RollCall attendance service
After=network.target

[Service]
User=rollcall
WorkingDirectory=/opt/rollcall/backend
Environment=ATTENDANCE_DB_PATH=/opt/rollcall/backend/data/attendance.db
ExecStart=/opt/rollcall/venv/bin/uvicorn app.main:app \
  --host 127.0.0.1 --port 8000 \
  --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=always

[Install]
WantedBy=multi-user.target
```

建议创建一个专用的 `rollcall` 系统用户来运行程序，而不是长期使用 root。启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rollcall
```

`enable` 表示服务器重启后自动启动，`--now` 表示立即启动。

> ⚠️ 本项目使用 SQLite，并且包含自动邮件调度器，因此只启动一个 Uvicorn 进程。不要随意增加多个 `--workers`，否则可能造成数据库竞争或重复发送邮件。

## 6. 配置 Nginx

创建 `/etc/nginx/sites-available/rollcall`：

```nginx
server {
    listen 80;
    server_name your-domain-or-ip;

    root /opt/rollcall/frontend/dist;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

含义如下：

- 普通网页请求读取 `frontend/dist` 中的静态文件。
- `/api/` 请求转发给 FastAPI（`X-Forwarded-For` 用于操作日志记录真实 IP）。
- `try_files ... /index.html` 支持 React 前端路由刷新。

启用并检查：

```bash
sudo ln -s /etc/nginx/sites-available/rollcall /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` 会先检查配置语法，检查成功后再重新加载，避免错误配置导致网页服务停止。

## 7. 防火墙和公网访问

云服务商安全组和系统防火墙都需要放行：

- `22/tcp`：SSH 管理（建议限制为自己的公网 IP）
- `80/tcp`：HTTP 网页
- `443/tcp`：HTTPS 网页

不要开放 `8000` 和 `5173`，这两个端口只供服务器内部使用。

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 8. 部署验证

```bash
curl http://127.0.0.1:8000/api/health   # 应返回 {"status":"ok"}
```

再从公网访问网站首页与登录接口确认正常。

## 9. 数据库与备份

生产数据库位置由环境变量 `ATTENDANCE_DB_PATH` 指定。SQLite 使用 WAL 模式时，不要直接复制数据库主文件；应使用 SQLite 的 `.backup` 命令，或同时处理 `-wal`、`-shm` 文件：

```bash
sqlite3 /opt/rollcall/backend/data/attendance.db ".backup /var/backups/rollcall/attendance-$(date +%F).db"
```

可配置 cron 每日备份并保留若干天；更可靠的做法是再配置云盘快照或对象存储异地备份。

## 10. 发布更新的推荐流程

1. 在本地修改代码并测试（`start.bat` / `start.ps1`）。
2. 运行后端测试与 `npm run build`。
3. 备份服务器数据库。
4. 只上传代码和新的 `frontend/dist`——**不要**用本地整个 `backend` 文件夹覆盖服务器，否则可能覆盖生产数据库。
5. 重启服务：`sudo systemctl restart rollcall`。
6. 访问公网地址验证。

## 11. 安全建议

1. 首次部署后立即把默认密码改掉。
2. 绑定域名并使用 Certbot 配置 HTTPS。
3. 在安全组中把 22 端口限制为自己的公网 IP。
4. 将数据库备份复制到异地存储。
5. 当前系统是共享管理员密码，知道密码的人都可以修改数据；如需按人分配权限，需要扩展用户与角色系统。

## 12. 常用维护命令

```bash
sudo systemctl status rollcall      # 服务状态
sudo journalctl -u rollcall -n 100 --no-pager   # 后端日志
sudo systemctl restart rollcall     # 重启后端
free -h                             # 查看内存
```

当前 2 GiB 内存运行该系统足够。生产环境采用 Nginx + 单个 Uvicorn 进程，不需要在服务器上运行 `npm run dev`。
