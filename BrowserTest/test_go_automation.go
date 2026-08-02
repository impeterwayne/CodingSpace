package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

type IssueItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	State     string `json:"state"`
	Assignee  string `json:"assignee"`
	TargetDate string `json:"target_date"`
}

func main() {
	fmt.Println("🚀 Testing Go Automation for Plane Backlog & Todo...")
	fmt.Println("===================================================")

	// Step 1: Execute bsk snapshot via Go os/exec
	fmt.Println("📌 Step 1: Executing bsk snapshot via Go os/exec...")
	cmd := exec.Command("bsk", "snapshot", "--session", "bbmn")
	out, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Printf("⚠️ Note: bsk CLI returned: %v\n", err)
	}

	snapshotText := string(out)
	fmt.Printf("✔ Received snapshot output (%d bytes)\n", len(snapshotText))

	// Step 2: Parse snapshot text inside Go
	fmt.Println("📌 Step 2: Parsing Backlog & Todo issues in Go...")
	backlog, todo := parseSnapshotInGo(snapshotText)

	fmt.Printf("✅ Backlog Issues Found: %d\n", len(backlog))
	for _, item := range backlog {
		fmt.Printf("   • [%s] %s (Assignee: %s, Due: %s)\n", item.ID, item.Title, item.Assignee, item.TargetDate)
	}

	fmt.Printf("\n✅ Todo Issues Found: %d\n", len(todo))
	for _, item := range todo {
		fmt.Printf("   • [%s] %s (Assignee: %s, Due: %s)\n", item.ID, item.Title, item.Assignee, item.TargetDate)
	}

	// Step 3: Generate Markdown Report in Go
	fmt.Println("\n📌 Step 3: Generating Markdown report in Go...")
	markdown := generateReportInGo(backlog, todo)
	reportPath := "PLANE_GO_AUTOMATION_TEST_RESULTS.md"
	err = os.WriteFile(reportPath, []byte(markdown), 0644)
	if err != nil {
		fmt.Printf("❌ Error writing report: %v\n", err)
		return
	}

	fmt.Printf("🎉 SUCCESS! Generated Go report: %s\n", reportPath)
}

func parseSnapshotInGo(text string) ([]IssueItem, []IssueItem) {
	lines := strings.Split(text, "\n")
	var backlog, todo []IssueItem
	var currentCol string

	for i := 0; i < len(lines); i++ {
		line := lines[i]

		if strings.Contains(line, `button "Backlog"`) {
			currentCol = "Backlog"
		} else if strings.Contains(line, `button "Todo"`) {
			currentCol = "Todo"
		} else if strings.Contains(line, `button "In Progress"`) {
			currentCol = "In Progress"
		} else if strings.Contains(line, `button "Done"`) {
			currentCol = "Done"
		}

		if currentCol == "Backlog" || currentCol == "Todo" {
			reID := regexp.MustCompile(`button "(PDFFILLSIG-\d+)"`)
			matches := reID.FindStringSubmatch(line)
			if len(matches) > 1 {
				issueID := matches[1]

				// Peek context block
				start := i - 4
				if start < 0 {
					start = 0
				}
				end := i + 12
				if end > len(lines) {
					end = len(lines)
				}

				title := ""
				date := "Unset"
				assignee := "Unassigned"

				for _, bline := range lines[start:end] {
					reBtn := regexp.MustCompile(`button "([^"]+)"`)
					bmatches := reBtn.FindStringSubmatch(bline)
					if len(bmatches) > 1 {
						val := bmatches[1]
						if strings.HasPrefix(val, "[") && title == "" {
							title = val
						} else if regexp.MustCompile(`(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+`).MatchString(val) {
							date = val
						} else if len(val) == 1 && val == strings.ToUpper(val) && assignee == "Unassigned" {
							assignee = val
						}
					}
				}

				item := IssueItem{
					ID:         issueID,
					Title:      title,
					State:      currentCol,
					Assignee:   assignee,
					TargetDate: date,
				}

				if currentCol == "Backlog" {
					if !containsIssue(backlog, issueID) {
						backlog = append(backlog, item)
					}
				} else if currentCol == "Todo" {
					if !containsIssue(todo, issueID) {
						todo = append(todo, item)
					}
				}
			}
		}
	}

	return backlog, todo
}

func containsIssue(list []IssueItem, id string) bool {
	for _, item := range list {
		if item.ID == id {
			return true
		}
	}
	return false
}

func generateReportInGo(backlog, todo []IssueItem) string {
	var sb strings.Builder
	sb.WriteString("# 🏎️ Golang Plane Automation Test Results\n\n")
	sb.WriteString(fmt.Sprintf("> Report generated at: %s via Go program\n\n", time.Now().Format("2006-01-02 15:04:05")))

	sb.WriteString(fmt.Sprintf("## Summary\n- **Backlog Items:** %d\n- **Todo Items:** %d\n- **Total Automated:** %d\n\n", len(backlog), len(todo), len(backlog)+len(todo)))

	sb.WriteString("## 🔴 Backlog Items\n\n")
	sb.WriteString("| Key | Title | Assignee | Target Date |\n")
	sb.WriteString("| :--- | :--- | :---: | :---: |\n")
	for _, item := range backlog {
		sb.WriteString(fmt.Sprintf("| **%s** | `%s` | %s | %s |\n", item.ID, item.Title, item.Assignee, item.TargetDate))
	}

	sb.WriteString("\n## 🟡 Todo Items\n\n")
	sb.WriteString("| Key | Title | Assignee | Target Date |\n")
	sb.WriteString("| :--- | :--- | :---: | :---: |\n")
	for _, item := range todo {
		sb.WriteString(fmt.Sprintf("| **%s** | `%s` | %s | %s |\n", item.ID, item.Title, item.Assignee, item.TargetDate))
	}

	return sb.String()
}
