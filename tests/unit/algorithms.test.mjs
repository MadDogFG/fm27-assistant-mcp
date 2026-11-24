import test from "node:test";
import assert from "node:assert/strict";
import { solveBestXi, parsePositionTags, parseWageToNumber } from "../../mcp/algorithms/best-xi.mjs";
import { analyzeSquadAndContracts } from "../../mcp/algorithms/squad-audit.mjs";

const MOCK_SQUAD = [
  { index: 0, name: "门神甲", age: "28", position: "门将", condition: "96%", sharpness: "90%", wage: "€15万/周" },
  { index: 1, name: "门神乙", age: "34", position: "门将", condition: "95%", sharpness: "80%", wage: "€20万/周" },
  { index: 2, name: "小门将", age: "19", position: "门将", condition: "98%", sharpness: "70%", wage: "€1万/周" },
  { index: 3, name: "多余门将", age: "31", position: "门将", condition: "92%", sharpness: "60%", wage: "€5万/周" },
  { index: 4, name: "右卫主力", age: "26", position: "后卫 (右)", condition: "92%", sharpness: "92%", wage: "€18万/周" },
  { index: 5, name: "中卫甲", age: "27", position: "后卫 (中)", condition: "94%", sharpness: "90%", wage: "€22万/周" },
  { index: 6, name: "中卫乙", age: "19", position: "后卫 (中)", condition: "97%", sharpness: "88%", wage: "€12万/周" },
  { index: 7, name: "中卫老将", age: "32", position: "后卫 (中)", condition: "58%", sharpness: "85%", wage: "€25万/周" },
  { index: 8, name: "左卫主力", age: "22", position: "后卫 (左)", condition: "91%", sharpness: "89%", wage: "€14万/周" },
  { index: 9, name: "铁腰甲", age: "30", position: "后腰", condition: "93%", sharpness: "95%", wage: "€40万/周" },
  { index: 10, name: "全能中场", age: "23", position: "中场 (中)", condition: "95%", sharpness: "93%", wage: "€24万/周" },
  { index: 11, name: "妖星后腰", age: "19", position: "后腰", condition: "98%", sharpness: "84%", wage: "€3万/周" },
  { index: 12, name: "右路天才", age: "19", position: "前腰 (右)", condition: "96%", sharpness: "96%", wage: "€35万/周" },
  { index: 13, name: "十号核", age: "27", position: "前腰 (中)", condition: "90%", sharpness: "90%", wage: "€22万/周" },
  { index: 14, name: "左翼尖刀", age: "25", position: "前腰 (左)", condition: "94%", sharpness: "91%", wage: "€28万/周" },
  { index: 15, name: "伤病前锋", age: "29", position: "前锋 (中)", condition: "40%", sharpness: "50%", wage: "€30万/周", injured: true },
  { index: 16, name: "主力中锋", age: "24", position: "前锋 (中)", condition: "91%", sharpness: "88%", wage: "€20万/周" },
  { index: 17, name: "青训前腰", age: "18", position: "前腰 (中)", condition: "99%", sharpness: "75%", wage: "€8000/周" },
  { index: 18, name: "轮换边卫", age: "24", position: "后卫 (右左)", condition: "90%", sharpness: "82%", wage: "€8万/周" },
  { index: 19, name: "替补边锋", age: "20", position: "前腰 (右)", condition: "93%", sharpness: "60%", wage: "€3万/周" },
  { index: 20, name: "替补中卫", age: "22", position: "后卫 (中)", condition: "92%", sharpness: "80%", wage: "€6万/周" },
  { index: 21, name: "替补中锋", age: "21", position: "前锋 (中)", condition: "94%", sharpness: "84%", wage: "€5万/周" }
];

test("位置字符串与中文周薪解析准确", () => {
  assert.ok(parsePositionTags("后卫 (右中)").has("DR"));
  assert.ok(parsePositionTags("后卫 (右中)").has("DC"));
  assert.ok(parsePositionTags("门将").has("GK"));
  assert.equal(parseWageToNumber("€24万/周"), 240_000);
  assert.equal(parseWageToNumber("€8000/周"), 8000);
});

test("optimize_best_xi 精确匈牙利匹配：不重复选人、隔离门将、排除伤停与疲劳老将", () => {
  const res = solveBestXi(MOCK_SQUAD, { formation: "4-2-3-1", minCondition: 75 });
  assert.equal(res.ok, true);
  assert.equal(res.startingXI.length, 11);

  const ids = res.startingXI.map(x => x.squadIndex);
  assert.equal(new Set(ids).size, 11, "11 个首发槽位严禁重复安排同一球员");
  assert.ok(!ids.includes(15), "伤病前锋必须自动排除");
  assert.ok(!ids.includes(7), "体能仅 58% 的老将中卫应被健康中卫替代");

  const gkSlot = res.startingXI.find(x => x.slot === "GK");
  assert.ok([0, 1, 2, 3].includes(gkSlot.squadIndex), "门将槽位必须安排真门将");
  for (const fieldSlot of res.startingXI.filter(x => x.slot !== "GK")) {
    assert.ok(![0, 1, 2, 3].includes(fieldSlot.squadIndex), "外场槽位绝不能排入守门员");
  }

  assert.equal(res.bench.length, 7);
  assert.equal(res.bench[0].role, "替补门将");
});

test("optimize_best_xi 青训练兵模式优先启用 U21 小妖", () => {
  const normal = solveBestXi(MOCK_SQUAD, { formation: "4-2-3-1", preferYouth: false });
  const youth = solveBestXi(MOCK_SQUAD, { formation: "4-2-3-1", preferYouth: true });
  const normalU21 = normal.startingXI.filter(x => x.age <= 21).length;
  const youthU21 = youth.startingXI.filter(x => x.age <= 21).length;
  assert.ok(youthU21 >= normalU21, `青训模式 U21 人数(${youthU21})应不少于常规模式(${normalU21})`);
});

test("audit_squad_and_contracts 精准识别冗员位置、深度缺口、疲劳与高薪老将", () => {
  const report = analyzeSquadAndContracts(MOCK_SQUAD);
  assert.equal(report.ok, true);
  assert.equal(report.squadSize, MOCK_SQUAD.length);
  assert.ok(report.bloated.some(b => b.positionGroup === "门将" && b.count === 4), "4 名门将应标为冗员");
  assert.ok(report.shortages.some(s => s.positionGroup === "边后卫/翼卫"), "仅 3 名边卫应标为缺口");
  assert.ok(report.fatigueRisks.some(f => f.index === 7), "体能 58% 应进入疲劳预警");
  assert.ok(report.highWageVeterans.some(v => v.index === 9), "30 岁 40 万/周铁腰应进入高薪老将清单");
  assert.ok(report.recommendations.length >= 2);
});
