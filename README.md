# 黑胶唱片分面规划(Vinyl Side-Split Planner)

录入按顺序排列的曲目时长与刻录参数,系统自动枚举所有 A/B 面切点,按**恒定沟距**模型计算每面的沟距,淘汰低于安全阈值的方案,并按「先最大化较差一面的沟距、再最小化两面时长差」的字典序规则选出最优切点。页面展示每个候选切点的完整计算明细与淘汰原因。

技术栈:React + TypeScript(Vite)/ Node.js(Express)/ SQLite(better-sqlite3),Docker 一键启动。

## 计算模型

对某个面(含 k 首曲目):

| 量 | 公式 |
| --- | --- |
| 可用径向宽度 W | 外有效半径 − 内有效半径 (mm) |
| 留白扣除 | (k − 1) × 曲间留白宽度 (mm) |
| 净径向宽度 Wn | W − 留白扣除 |
| 总转数 N | 音乐总时长(秒) × 转速(rpm) ÷ 60 |
| 恒定沟距 p | Wn × 1000 ÷ N (µm/转) |
| 留白播放耗时 | 留白宽 × 1000 ÷ p ÷ rpm × 60 (秒) |
| 面总时长 | 音乐时长 + 留白播放耗时 |

规则:

1. **枚举**:n 首曲目有 n − 1 个切点,A 面 = 第 1..c 首,B 面 = 第 c+1..n 首(两面均非空)。
2. **过滤**:任一面 `p < 最小沟距` 或 `Wn ≤ 0` → 淘汰,并记录具体原因。
3. **优选**:合格方案中先最大化 `min(pA, pB)`(较差一面的沟距);并列时再最小化 `|TA − TB|`(两面总时长差)。

## 快速开始(Docker)

```bash
docker compose up --build
# 打开 http://localhost:8080
```

SQLite 数据持久化在命名卷 `vinyl-data` 中。首次启动时数据库为空会自动写入示例方案。

也可以不用 Compose:

```bash
docker build -t vinyl-planner .
docker run -p 8080:8080 -v vinyl-data:/app/data vinyl-planner
```

## 本地开发

```bash
# 终端 1:后端(http://localhost:8080)
cd server && npm install && npm run dev

# 终端 2:前端(http://localhost:5173,/api 自动代理到 8080)
cd client && npm install && npm run dev
```

## 测试与构建

```bash
cd server && npm test        # 规划算法单元测试(node:test)
cd server && npm run build   # 编译 TypeScript → dist/
cd client && npm run build   # 类型检查 + 打包 → dist/
```

生产模式本地运行:

```bash
cd client && npm run build
cd ../server && npm run build
STATIC_DIR=../client/dist npm start
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/plan` | 计算分面方案,body:`{ tracks: [{name, durationSec}], params: {rpm, outerRadiusMm, innerRadiusMm, gapWidthMm, minPitchUm} }` |
| GET | `/api/projects` | 已存方案列表 |
| GET | `/api/projects/:id` | 方案详情(含 tracks 与 params) |
| POST | `/api/projects` | 保存方案,body:`{ name, tracks, params }` |
| DELETE | `/api/projects/:id` | 删除方案 |

示例:

```bash
curl -X POST http://localhost:8080/api/plan \
  -H 'Content-Type: application/json' \
  -d @sample/sample-album.json   # 该文件含 name 字段,多余字段会被忽略
```

## 目录结构

```
├── Dockerfile              # 多阶段:前端构建 → 后端编译 → 精简运行时
├── docker-compose.yml
├── sample/sample-album.json# 示例数据(与服务端内置种子一致)
├── server/                 # Express + better-sqlite3
│   ├── src/planner.ts      # 核心规划算法(纯函数)
│   ├── src/db.ts           # SQLite 持久化 + 启动种子
│   ├── src/index.ts        # HTTP API + 静态托管
│   └── test/planner.test.ts
└── client/                 # React + TypeScript (Vite)
    └── src/components/     # 参数表单 / 曲目编辑 / 结果明细
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 服务端口 |
| `DB_PATH` | `./data/vinyl.db`(容器内 `/app/data/vinyl.db`) | SQLite 文件路径 |
| `STATIC_DIR` | `./public`(容器内 `/app/public`) | 前端静态资源目录 |
