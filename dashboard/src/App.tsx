import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { CommandCenter } from "./pages/CommandCenter";
import { AttentionQueue } from "./pages/AttentionQueue";
import { IssueDetail } from "./pages/IssueDetail";
import { ProjectHealth } from "./pages/ProjectHealth";
import { AgentActivity } from "./pages/AgentActivity";
import { Decisions } from "./pages/Decisions";
import { WeeklyBrief } from "./pages/WeeklyBrief";
import { DuplicateIntelligence } from "./pages/DuplicateIntelligence";
import { SecuritySignals } from "./pages/SecuritySignals";
import { ProjectMemory } from "./pages/ProjectMemory";
import { ApprovalCenter } from "./pages/ApprovalCenter";
import { CodeGraph } from "./pages/CodeGraph";
import { AskAI } from "./pages/AskAI";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<CommandCenter />} />
        <Route path="/attention" element={<AttentionQueue />} />
        <Route path="/issue/:id" element={<IssueDetail />} />
        <Route path="/health" element={<ProjectHealth />} />
        <Route path="/activity" element={<AgentActivity />} />
        <Route path="/decisions" element={<Decisions />} />
        <Route path="/brief" element={<WeeklyBrief />} />
        <Route path="/duplicates" element={<DuplicateIntelligence />} />
        <Route path="/security" element={<SecuritySignals />} />
        <Route path="/memory" element={<ProjectMemory />} />
        <Route path="/approvals" element={<ApprovalCenter />} />
        <Route path="/code-graph" element={<CodeGraph />} />
        <Route path="/ask" element={<AskAI />} />
      </Route>
    </Routes>
  );
}
