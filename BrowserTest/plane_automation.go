package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// Issue represents a Plane issue model
type Issue struct {
	ID          string `json:"id"`
	SequenceID  int    `json:"sequence_id"`
	Name        string `json:"name"`
	Description string `json:"description_html"`
	Priority    string `json:"priority"`
	StateID     string `json:"state"`
	StateName   string
	StateGroup  string
	StartDate   string `json:"start_date"`
	TargetDate  string `json:"target_date"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// State represents a Plane state model
type State struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Group string `json:"group"`
}

// PlaneConfig holds workspace and project credentials
type PlaneConfig struct {
	BaseURL       string
	WorkspaceSlug string
	ProjectID     string
	APIKey        string
}

func main() {
	fmt.Println("🚀 Plane Comprehensive Task List Automator — Golang REST API")
	fmt.Println("=========================================================")

	apiKey := os.Getenv("PLANE_API_KEY")
	if apiKey == "" {
		apiKey = "plane_api_468d764bbdbe4b87ae158976ac2e1559"
	}

	cfg := PlaneConfig{
		BaseURL:       "https://plane.itgproduct.com",
		WorkspaceSlug: "product",
		ProjectID:     "72f1bdd9-8420-469f-93f7-fe27b6658b9c",
		APIKey:        apiKey,
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// 1. Fetch States Map
	stateMap, err := FetchProjectStates(cfg, client)
	if err != nil {
		fmt.Printf("❌ Failed to fetch states: %v\n", err)
		return
	}

	// 2. Fetch All Issues
	issues, err := FetchProjectIssues(cfg, client)
	if err != nil {
		fmt.Printf("❌ Failed to fetch issues: %v\n", err)
		return
	}

	// 3. Categorize into ALL state groups
	var backlog, todo, inProgress, done, cancelled, other []Issue

	for i := range issues {
		stateID := issues[i].StateID
		if stateInfo, ok := stateMap[stateID]; ok {
			issues[i].StateName = stateInfo.Name
			issues[i].StateGroup = stateInfo.Group
		} else {
			issues[i].StateName = "Unknown"
			issues[i].StateGroup = "other"
		}

		group := strings.ToLower(issues[i].StateGroup)
		name := strings.ToLower(issues[i].StateName)

		if group == "backlog" || name == "backlog" {
			backlog = append(backlog, issues[i])
		} else if group == "unstarted" || name == "todo" {
			todo = append(todo, issues[i])
		} else if group == "started" || name == "in progress" {
			inProgress = append(inProgress, issues[i])
		} else if group == "completed" || name == "done" {
			done = append(done, issues[i])
		} else if group == "cancelled" || name == "cancelled" {
			cancelled = append(cancelled, issues[i])
		} else {
			other = append(other, issues[i])
		}
	}

	fmt.Printf("✔ Successfully loaded ALL %d tasks across all states!\n", len(issues))
	fmt.Printf("   • 🔴 Backlog:     %d\n", len(backlog))
	fmt.Printf("   • 🟡 Todo:        %d\n", len(todo))
	fmt.Printf("   • 🔵 In Progress: %d\n", len(inProgress))
	fmt.Printf("   • 🟢 Done:        %d\n", len(done))
	fmt.Printf("   • ⚪ Cancelled:   %d\n", len(cancelled))
	if len(other) > 0 {
		fmt.Printf("   • ❓ Other/Draft:  %d\n", len(other))
	}

	// 4. Generate Task List MD File
	reportMD := GenerateComprehensiveTaskListMD(cfg, backlog, todo, inProgress, done, cancelled, other)

	// Save to workspace task list file
	workspacePath := "PLANE_TASK_LIST.md"
	err = os.WriteFile(workspacePath, []byte(reportMD), 0644)
	if err != nil {
		fmt.Printf("❌ Failed to write task list: %v\n", err)
		return
	}

	// Save to artifact directory
	artifactPath := "C:\\Users\\admin\\.gemini\\antigravity-cli\\brain\\d8ae249a-ba7c-4f7a-acb1-0f56ffe6a9cd\\PLANE_TASK_LIST.md"
	_ = os.WriteFile(artifactPath, []byte(reportMD), 0644)

	fmt.Printf("\n🎉 SUCCESS! Comprehensive Task List Markdown generated: %s\n", workspacePath)
}

func FetchProjectStates(cfg PlaneConfig, client *http.Client) (map[string]State, error) {
	url := fmt.Sprintf("%s/api/v1/workspaces/%s/projects/%s/states/", cfg.BaseURL, cfg.WorkspaceSlug, cfg.ProjectID)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	stateMap := make(map[string]State)

	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err == nil {
		if results, ok := raw["results"].([]interface{}); ok {
			resultsBytes, _ := json.Marshal(results)
			var states []State
			json.Unmarshal(resultsBytes, &states)
			for _, s := range states {
				stateMap[s.ID] = s
			}
			return stateMap, nil
		}
	}

	var stateList []State
	if err := json.Unmarshal(body, &stateList); err == nil {
		for _, s := range stateList {
			stateMap[s.ID] = s
		}
	}

	return stateMap, nil
}

func FetchProjectIssues(cfg PlaneConfig, client *http.Client) ([]Issue, error) {
	url := fmt.Sprintf("%s/api/v1/workspaces/%s/projects/%s/issues/", cfg.BaseURL, cfg.WorkspaceSlug, cfg.ProjectID)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d (%s)", resp.StatusCode, resp.Status)
	}

	body, _ := io.ReadAll(resp.Body)
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}

	resultsRaw, ok := raw["results"]
	if !ok {
		return nil, fmt.Errorf("no results field in JSON response")
	}

	resultsJSON, _ := json.Marshal(resultsRaw)
	var issues []Issue
	if err := json.Unmarshal(resultsJSON, &issues); err != nil {
		return nil, err
	}

	return issues, nil
}

// GenerateComprehensiveTaskListMD formats ALL tasks across all states into Markdown Task Checklist
func GenerateComprehensiveTaskListMD(cfg PlaneConfig, backlog, todo, inProgress, done, cancelled, other []Issue) string {
	var sb strings.Builder

	totalCount := len(backlog) + len(todo) + len(inProgress) + len(done) + len(cancelled) + len(other)

	sb.WriteString("# 📋 Plane Comprehensive Task List (All States)\n\n")
	sb.WriteString(fmt.Sprintf("> **Workspace:** `%s` | **Project:** `PDF Fill&Sign 5` (`%s`)  \n", cfg.WorkspaceSlug, cfg.ProjectID))
	sb.WriteString(fmt.Sprintf("> **Generated:** %s  \n", time.Now().Format("2006-01-02 15:04:05")))
	sb.WriteString(fmt.Sprintf("> **Total Tasks Included:** **%d** (All Categories)  \n\n", totalCount))

	sb.WriteString("--- \n\n")
	sb.WriteString("## 📊 Summary Overview\n\n")
	sb.WriteString("| State Category | Task Count | Status Emoji |\n")
	sb.WriteString("| :--- | :---: | :---: |\n")
	sb.WriteString(fmt.Sprintf("| 🔴 **Backlog** | %d | 🔴 |\n", len(backlog)))
	sb.WriteString(fmt.Sprintf("| 🟡 **Todo** | %d | 🟡 |\n", len(todo)))
	sb.WriteString(fmt.Sprintf("| 🔵 **In Progress** | %d | 🔵 |\n", len(inProgress)))
	sb.WriteString(fmt.Sprintf("| 🟢 **Done** | %d | 🟢 |\n", len(done)))
	sb.WriteString(fmt.Sprintf("| ⚪ **Cancelled** | %d | ⚪ |\n", len(cancelled)))
	if len(other) > 0 {
		sb.WriteString(fmt.Sprintf("| ❓ **Other/Draft** | %d | ❓ |\n", len(other)))
	}
	sb.WriteString(fmt.Sprintf("| **TOTAL** | **%d** | ✨ |\n\n", totalCount))

	// 1. Backlog
	if len(backlog) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## 🔴 1. Backlog Tasks (%d)\n\n", len(backlog)))
		for _, item := range backlog {
			sb.WriteString(fmt.Sprintf("- [ ] **PDFFILLSIG-%d**: %s\n", item.SequenceID, item.Name))
			sb.WriteString(fmt.Sprintf("  - **Priority:** %s | **Start Date:** `%s`\n", formatPriority(item.Priority), formatDate(item.StartDate)))
			if desc := cleanHTML(item.Description); desc != "" {
				sb.WriteString(fmt.Sprintf("  - **Details/Evidence:** %s\n", desc))
			}
			sb.WriteString("\n")
		}
	}

	// 2. Todo
	if len(todo) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## 🟡 2. Todo Tasks (%d)\n\n", len(todo)))
		for _, item := range todo {
			sb.WriteString(fmt.Sprintf("- [ ] **PDFFILLSIG-%d**: %s\n", item.SequenceID, item.Name))
			sb.WriteString(fmt.Sprintf("  - **Priority:** %s | **Start Date:** `%s`\n", formatPriority(item.Priority), formatDate(item.StartDate)))
			if desc := cleanHTML(item.Description); desc != "" {
				sb.WriteString(fmt.Sprintf("  - **Details/Evidence:** %s\n", desc))
			}
			sb.WriteString("\n")
		}
	}

	// 3. In Progress
	if len(inProgress) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## 🔵 3. In Progress Tasks (%d)\n\n", len(inProgress)))
		for _, item := range inProgress {
			sb.WriteString(fmt.Sprintf("- [/] **PDFFILLSIG-%d**: %s\n", item.SequenceID, item.Name))
			sb.WriteString(fmt.Sprintf("  - **Priority:** %s | **Start Date:** `%s` | **Last Updated:** `%s`\n", formatPriority(item.Priority), formatDate(item.StartDate), formatDate(item.UpdatedAt)))
			if desc := cleanHTML(item.Description); desc != "" {
				sb.WriteString(fmt.Sprintf("  - **Details/Evidence:** %s\n", desc))
			}
			sb.WriteString("\n")
		}
	}

	// 4. Done
	if len(done) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## 🟢 4. Done Tasks (%d)\n\n", len(done)))
		for _, item := range done {
			sb.WriteString(fmt.Sprintf("- [x] **PDFFILLSIG-%d**: %s\n", item.SequenceID, item.Name))
			sb.WriteString(fmt.Sprintf("  - **Priority:** %s | **Completed At:** `%s`\n", formatPriority(item.Priority), formatDate(item.UpdatedAt)))
			if desc := cleanHTML(item.Description); desc != "" {
				sb.WriteString(fmt.Sprintf("  - **Details/Evidence:** %s\n", desc))
			}
			sb.WriteString("\n")
		}
	}

	// 5. Cancelled
	if len(cancelled) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## ⚪ 5. Cancelled Tasks (%d)\n\n", len(cancelled)))
		for _, item := range cancelled {
			sb.WriteString(fmt.Sprintf("- [ ] ~**PDFFILLSIG-%d**: %s~\n", item.SequenceID, item.Name))
			sb.WriteString(fmt.Sprintf("  - **Priority:** %s\n", formatPriority(item.Priority)))
			if desc := cleanHTML(item.Description); desc != "" {
				sb.WriteString(fmt.Sprintf("  - **Details/Evidence:** %s\n", desc))
			}
			sb.WriteString("\n")
		}
	}

	// 6. Other / Draft
	if len(other) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## ❓ 6. Other / Draft Tasks (%d)\n\n", len(other)))
		for _, item := range other {
			sb.WriteString(fmt.Sprintf("- [ ] **PDFFILLSIG-%d**: %s (State: %s)\n", item.SequenceID, item.Name, item.StateName))
			sb.WriteString(fmt.Sprintf("  - **Priority:** %s\n", formatPriority(item.Priority)))
			if desc := cleanHTML(item.Description); desc != "" {
				sb.WriteString(fmt.Sprintf("  - **Details/Evidence:** %s\n", desc))
			}
			sb.WriteString("\n")
		}
	}

	sb.WriteString("---\n*Comprehensive task list generated automatically via Golang REST API client.*")
	return sb.String()
}

func formatPriority(prio string) string {
	switch strings.ToLower(prio) {
	case "urgent":
		return "🔥 Urgent"
	case "high":
		return "🔴 High"
	case "medium":
		return "🟡 Medium"
	case "low":
		return "🔵 Low"
	default:
		return "⚪ None"
	}
}

func formatDate(d string) string {
	if d == "" {
		return "Unset"
	}
	return d
}

func cleanHTML(in string) string {
	if in == "" {
		return ""
	}
	re := regexp.MustCompile(`<[^>]*>`)
	cleaned := re.ReplaceAllString(in, " ")
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	return cleaned
}
