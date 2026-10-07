# 黑胶唱片分面规划(Vinyl Side-Split Planner)

录入按顺序排列的曲目时长与刻录参数,系统自动枚举所有 A/B 面切点,计算每面的沟距占用,淘汰低于安全阈值的方案,并按「先最大化较差一面的沟距、再最小化两面时长差」的字典序规则选出最优切点。页面展示每个候选切点的完整计算明细与淘汰原因。

支持两种沟距模式:

- **恒定沟距(constant,默认)**:全碟统一沟距 `p = Wn × 1000 ÷ N`。
- **可变沟距(variable)**:为每首曲目录入 0.5~2 的动态系数(响度/调制需求越大系数越大),各轨实际沟距为 `max(最小沟距, λ × 动态系数)`,系统求不超过可用径向宽度的最大 λ,并展示每轨实际沟距及从外圈向内的起止半径。

技术栈:React + TypeScript(Vite)/ Node.js(Express)/ SQLite(better-sqlite3),Docker 一键启动。

## 访问地址

| 方式 | 启动命令 | 浏览器访问 |
| --- | --- | --- |
| Docker Compose(推荐) | `docker compose up --build` | http://localhost:8080 |
| Docker 直接运行 | 见下文 | http://localhost:8080 |
| 本地开发(前端热更新) | 前后端分别 `npm run dev` | http://localhost:5173(`/api` 自动代理到 8080) |

端口可通过环境变量 `PORT` 与 compose 端口映射修改。

## 计算模型

对某个面(含 k 首曲目):

| 量 | 公式 |
| --- | --- |
| 可用径向宽度 W | 外有效半径 − 内有效半径 (mm) |
| 留白扣除 | (k − 1) × 曲间留白宽度 (mm) |
| 净径向宽度 Wn | W − 留白扣除 |
| 第 i 轨转数 n_i | 该轨时长(秒) × 转速(rpm) ÷ 60 |
| 留白播放耗时 | 留白宽 × 1000 ÷ 留白沟距 ÷ rpm × 60 (秒) |

### 恒定沟距模式

| 量 | 公式 |
| --- | --- |
| 总转数 N | 音乐总时长(秒) × rpm ÷ 60 |
| 恒定沟距 p | Wn × 1000 ÷ N (µm/转) |
| 留白沟距 | 同 p |
| 面总时长 | 音乐时长 + 留白播放耗时 |

### 可变沟距模式

每首曲目带动态系数 c_i ∈ [0.5, 2],λ 为系数 1 对应的基准沟距(µm/转):

| 量 | 公式 |
| --- | --- |
| 第 i 轨实际沟距 p_i | `max(minPitchUm, λ × c_i)` |
| 音乐径向占用 D(λ) | Σ_i n_i × p_i (µm) |
| 最大 λ | 令 D(λ) = Wn × 1000 求根 |
| 留白沟距 p_gap | `max(minPitchUm, λ)`(留白宽度固定,仅决定播放耗时) |
| 面总时长 | 音乐时长 + Σ 留白播放耗时 |

**λ 的求解**:D(λ) 关于 λ 是分段线性、斜率只增不减的单调函数——每轨在 λ < `minPitchUm / c_i` 前压在最低沟距(常量段),越过该转折点后变为 `n_i·c_i·λ`(线性段)。将所有转折点升序排列,逐段做一次线性求根即可得到精确解,无需迭代逼近。

**淘汰条件**:即使所有曲目都压在最低沟距上,音乐占用 + 留白宽度仍超过可用径向宽度时,该切点该面被淘汰,并给出所需宽度明细。

**径向排布**:解出 λ 后从外圈半径起,按曲目顺序逐轨向内累加 `n_i × p_i`,曲间插入固定宽度留白带,得到每轨(及每条留白)的起始/结束半径。

### 枚举与优选(两种模式通用)

1. **枚举**:n 首曲目有 n − 1 个切点,A 面 = 第 1..c 首,B 面 = 第 c+1..n 首(两面均非空)。
2. **过滤**:任一面不满足安全约束 → 淘汰,并记录具体原因。
3. **优选**:
   - 恒定模式:先最大化 `min(pA, pB)`(较差一面沟距);
   - 可变模式:先最大化 `min(λA, λB)`(较差一面基准 λ,等价于先让最吃紧的一面系数 1 曲目最宽);
   - 并列时再最小化 `|TA − TB|`(两面总时长差)。
4. **排序**:恒定模式候选按切点升序展示(保持原始行为);可变模式按优选规则(较差面 λ 降序、时长差升序)展示,淘汰方案沉底。

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
# 打开 http://localhost:8080
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
cd server && npm test        # 规划算法单元测试(node:test,含两种模式)
cd server && npm run build   # 编译 TypeScript → dist/
cd client && npm run build   # 类型检查 + 打包 → dist/
```

生产模式本地运行:

```bash
cd client && npm run build
cd ../server && npm run build
STATIC_DIR=../client/dist npm start
# 打开 http://localhost:8080
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/plan` | 计算分面方案 |
| GET | `/api/projects` | 已存方案列表 |
| GET | `/api/projects/:id` | 方案详情(含 tracks 与 params) |
| POST | `/api/projects` | 保存方案(模式与动态系数随方案一并持久化) |
| DELETE | `/api/projects/:id` | 删除方案 |

`POST /api/plan` / `/api/projects` body:

```json
{
  "tracks": [{ "name": "曲名", "durationSec": 312, "dynamicCoeff": 1.4 }],
  "params": {
    "mode": "variable",
    "rpm": 33.333,
    "outerRadiusMm": 146,
    "innerRadiusMm": 60,
    "gapWidthMm": 1.2,
    "minPitchUm": 80
  }
}
```

说明:

- `mode` 缺省为 `"constant"`(兼容旧方案);`"variable"` 时每首曲目的 `dynamicCoeff` 必须在 0.5~2 之间。
- 恒定模式下 `dynamicCoeff` 可省略,即使存在也不参与计算;保存/加载会原样保留。
- 返回的每个面对象在可变模式下含 `lambdaUm`、`minTrackPitchUm`、`gapPitchUm`,以及 `tracks[].pitchUm/startRadiusMm/endRadiusMm` 与 `gaps[]` 径向排布明细。

示例:

```bash
curl -X POST http://localhost:8080/api/plan \
  -H 'Content-Type: application/json' \
  -d @sample/sample-album.json   # 该文件含 name 字段,多余字段会被忽略
```

## 目录结构

```
├── Dockerfile              # 多阶段:前端构建 → 后端编译 → 精简运行时
├── docker-compose.yml      # 一键启动,访问 http://localhost:8080
├── sample/sample-album.json# 示例数据(与服务端内置种子一致)
├── server/                 # Express + better-sqlite3
│   ├── src/planner.ts      # 核心规划算法(恒定/可变两种模式,纯函数)
│   ├── src/db.ts           # SQLite 持久化 + 启动种子
│   ├── src/index.ts        # HTTP API + 静态托管
│   └── test/planner*.test.ts
└── client/                 # React + TypeScript (Vite)
    └── src/components/     # 参数表单(模式切换) / 曲目编辑(动态系数) / 结果明细
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 服务端口 |
| `DB_PATH` | `./data/vinyl.db`(容器内 `/app/data/vinyl.db`) | SQLite 文件路径 |
| `STATIC_DIR` | `./public`(容器内 `/app/public`) | 前端静态资源目录 |
