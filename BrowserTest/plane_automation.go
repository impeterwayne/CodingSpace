package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
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

// EvidenceMedia represents extracted and downloaded evidence asset info
type EvidenceMedia struct {
	Type        string // "image" or "video"
	WebURL      string // Original evidence web URL
	MediaID     string // Unique ID e.g. "llDx-MZiSyaG" or "dghptv"
	LocalPath   string // Relative path for MD: "./evidence/PDFFILLSIG-31/llDx.png"
	PosterPath  string // Relative path for video thumbnail: "./evidence/PDFFILLSIG-29/dghptv_poster.jpg"
}

const UserAgentHeader = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

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

	client := &http.Client{Timeout: 30 * time.Second}

	// 1. Ensure plane/ output directory structure exists
	exportDir := "plane"
	evidenceDir := filepath.Join(exportDir, "evidence")
	rawDir := filepath.Join(exportDir, "raw")
	_ = os.MkdirAll(evidenceDir, 0755)
	_ = os.MkdirAll(rawDir, 0755)

	// Exclude plane/ directory from Git
	ExcludePlaneDirectoryFromGit(".")

	// 2. Fetch States Map
	rawStatesBody, stateMap, err := FetchProjectStatesRaw(cfg, client)
	if err != nil {
		fmt.Printf("❌ Failed to fetch states: %v\n", err)
		return
	}
	_ = os.WriteFile(filepath.Join(rawDir, "states.json"), PrettyFormatJSON(rawStatesBody), 0644)

	// 3. Fetch All Issues
	rawIssuesBody, issues, err := FetchProjectIssuesRaw(cfg, client)
	if err != nil {
		fmt.Printf("❌ Failed to fetch issues: %v\n", err)
		return
	}
	_ = os.WriteFile(filepath.Join(rawDir, "issues.json"), PrettyFormatJSON(rawIssuesBody), 0644)

	// 4. Process evidence media downloads for each task
	fmt.Println("📥 Processing task evidence downloads (prnt.sc screenshots & Streamable videos)...")
	taskMediaMap := make(map[int][]EvidenceMedia)
	for _, issue := range issues {
		mediaList := ProcessTaskEvidence(exportDir, issue.SequenceID, issue.Description, client)
		if len(mediaList) > 0 {
			taskMediaMap[issue.SequenceID] = mediaList
		}
	}

	// 5. Categorize into ALL state groups
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

	// 6. Generate Task List MD File with evidence previews
	reportMD := GenerateComprehensiveTaskListMD(cfg, backlog, todo, inProgress, done, cancelled, other, taskMediaMap)

	// Save to plane/TASK_LIST.md
	planeTaskPath := filepath.Join(exportDir, "TASK_LIST.md")
	err = os.WriteFile(planeTaskPath, []byte(reportMD), 0644)
	if err != nil {
		fmt.Printf("❌ Failed to write plane task list: %v\n", err)
		return
	}

	// Also maintain root PLANE_TASK_LIST.md for backward compatibility
	rootTaskPath := "PLANE_TASK_LIST.md"
	_ = os.WriteFile(rootTaskPath, []byte(reportMD), 0644)

	// Save to artifact directory
	artifactPath := "C:\\Users\\admin\\.gemini\\antigravity-cli\\brain\\d8ae249a-ba7c-4f7a-acb1-0f56ffe6a9cd\\PLANE_TASK_LIST.md"
	_ = os.WriteFile(artifactPath, []byte(reportMD), 0644)

	fmt.Printf("\n🎉 SUCCESS! Comprehensive Task List Markdown generated: %s\n", planeTaskPath)
}

func FetchProjectStatesRaw(cfg PlaneConfig, client *http.Client) ([]byte, map[string]State, error) {
	url := fmt.Sprintf("%s/api/v1/workspaces/%s/projects/%s/states/", cfg.BaseURL, cfg.WorkspaceSlug, cfg.ProjectID)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
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
			return body, stateMap, nil
		}
	}

	var stateList []State
	if err := json.Unmarshal(body, &stateList); err == nil {
		for _, s := range stateList {
			stateMap[s.ID] = s
		}
	}

	return body, stateMap, nil
}

func FetchProjectIssuesRaw(cfg PlaneConfig, client *http.Client) ([]byte, []Issue, error) {
	url := fmt.Sprintf("%s/api/v1/workspaces/%s/projects/%s/issues/", cfg.BaseURL, cfg.WorkspaceSlug, cfg.ProjectID)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("HTTP %d (%s)", resp.StatusCode, resp.Status)
	}

	body, _ := io.ReadAll(resp.Body)
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, nil, err
	}

	resultsRaw, ok := raw["results"]
	if !ok {
		return nil, nil, fmt.Errorf("no results field in JSON response")
	}

	resultsJSON, _ := json.Marshal(resultsRaw)
	var issues []Issue
	if err := json.Unmarshal(resultsJSON, &issues); err != nil {
		return nil, nil, err
	}

	return body, issues, nil
}

// ProcessTaskEvidence scans task description HTML for evidence links and downloads them
func ProcessTaskEvidence(exportDir string, seqID int, descHTML string, client *http.Client) []EvidenceMedia {
	if descHTML == "" {
		return nil
	}

	taskID := fmt.Sprintf("PDFFILLSIG-%d", seqID)
	taskEvidenceDir := filepath.Join(exportDir, "evidence", taskID)
	_ = os.MkdirAll(taskEvidenceDir, 0755)

	var results []EvidenceMedia

	// 1. Lightshot links: https://prnt.sc/[id]
	prntRe := regexp.MustCompile(`https?://prnt\.sc/([a-zA-Z0-9_-]+)`)
	prntMatches := prntRe.FindAllStringSubmatch(descHTML, -1)
	for _, match := range prntMatches {
		if len(match) < 2 {
			continue
		}
		webURL := match[0]
		mediaID := match[1]

		targetFile := filepath.Join(taskEvidenceDir, mediaID+".png")
		relMDPath := fmt.Sprintf("./evidence/%s/%s.png", taskID, mediaID)

		// Local Caching Check
		if fi, err := os.Stat(targetFile); err == nil && fi.Size() > 0 {
			if !containsMediaID(results, mediaID) {
				results = append(results, EvidenceMedia{
					Type:      "image",
					WebURL:    webURL,
					MediaID:   mediaID,
					LocalPath: relMDPath,
				})
			}
			continue
		}

		// Download Lightshot screenshot
		fmt.Printf("   📸 Downloading Lightshot screenshot: %s -> %s\n", webURL, targetFile)
		imgURL, err := scrapeLightshotImageURL(webURL, client)
		if err == nil && imgURL != "" {
			if downloadFile(imgURL, targetFile, client) == nil {
				if !containsMediaID(results, mediaID) {
					results = append(results, EvidenceMedia{
						Type:      "image",
						WebURL:    webURL,
						MediaID:   mediaID,
						LocalPath: relMDPath,
					})
				}
			}
		}
	}

	// 2. Streamable video links: https://streamable.com/[id]
	streamableRe := regexp.MustCompile(`https?://streamable\.com/([a-zA-Z0-9_-]+)`)
	streamableMatches := streamableRe.FindAllStringSubmatch(descHTML, -1)
	for _, match := range streamableMatches {
		if len(match) < 2 {
			continue
		}
		webURL := match[0]
		mediaID := match[1]

		targetVideoFile := filepath.Join(taskEvidenceDir, mediaID+".mp4")
		targetPosterFile := filepath.Join(taskEvidenceDir, mediaID+"_poster.jpg")
		relVideoPath := fmt.Sprintf("./evidence/%s/%s.mp4", taskID, mediaID)
		relPosterPath := fmt.Sprintf("./evidence/%s/%s_poster.jpg", taskID, mediaID)

		// Local Caching Check for Video
		if fi, err := os.Stat(targetVideoFile); err == nil && fi.Size() > 0 {
			if !containsMediaID(results, mediaID) {
				results = append(results, EvidenceMedia{
					Type:       "video",
					WebURL:     webURL,
					MediaID:    mediaID,
					LocalPath:  relVideoPath,
					PosterPath: relPosterPath,
				})
			}
			continue
		}

		// Download Streamable full video + poster
		fmt.Printf("   🎥 Downloading Streamable full video: %s -> %s\n", webURL, targetVideoFile)
		videoURL, posterURL, err := scrapeStreamableMediaURLs(mediaID, webURL, client)
		if err == nil {
			if posterURL != "" {
				_ = downloadFile(posterURL, targetPosterFile, client)
			}
			if videoURL != "" && downloadFile(videoURL, targetVideoFile, client) == nil {
				if !containsMediaID(results, mediaID) {
					results = append(results, EvidenceMedia{
						Type:       "video",
						WebURL:     webURL,
						MediaID:    mediaID,
						LocalPath:  relVideoPath,
						PosterPath: relPosterPath,
					})
				}
			}
		}
	}

	return results
}

func containsMediaID(list []EvidenceMedia, mediaID string) bool {
	for _, m := range list {
		if m.MediaID == mediaID {
			return true
		}
	}
	return false
}

func scrapeLightshotImageURL(prntURL string, client *http.Client) (string, error) {
	req, _ := http.NewRequest("GET", prntURL, nil)
	req.Header.Set("User-Agent", UserAgentHeader)

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	body := string(bodyBytes)

	// Search for og:image or #screenshot-image src
	ogRe := regexp.MustCompile(`<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']`)
	if match := ogRe.FindStringSubmatch(body); len(match) > 1 {
		return match[1], nil
	}

	imgRe := regexp.MustCompile(`id=["']screenshot-image["']\s+src=["']([^"']+)["']`)
	if match := imgRe.FindStringSubmatch(body); len(match) > 1 {
		return match[1], nil
	}

	return "", fmt.Errorf("no image found on Lightshot page")
}

func scrapeStreamableMediaURLs(mediaID string, streamableURL string, client *http.Client) (string, string, error) {
	// Try Streamable public API endpoint first
	apiURL := fmt.Sprintf("https://api.streamable.com/videos/%s", mediaID)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("User-Agent", UserAgentHeader)

	resp, err := client.Do(req)
	if err == nil && resp.StatusCode == http.StatusOK {
		defer resp.Body.Close()
		bodyBytes, _ := io.ReadAll(resp.Body)
		var apiRes map[string]interface{}
		if json.Unmarshal(bodyBytes, &apiRes) == nil {
			var videoURL, posterURL string
			if thumbnail, ok := apiRes["thumbnail_url"].(string); ok {
				posterURL = fixProtocolRelativeURL(thumbnail)
			}
			if files, ok := apiRes["files"].(map[string]interface{}); ok {
				if mp4, ok := files["mp4"].(map[string]interface{}); ok {
					if u, ok := mp4["url"].(string); ok {
						videoURL = fixProtocolRelativeURL(u)
					}
				}
			}
			if videoURL != "" {
				return videoURL, posterURL, nil
			}
		}
	}

	// Fallback to HTML scraping
	req2, _ := http.NewRequest("GET", streamableURL, nil)
	req2.Header.Set("User-Agent", UserAgentHeader)
	resp2, err := client.Do(req2)
	if err != nil {
		return "", "", err
	}
	defer resp2.Body.Close()

	bodyBytes, _ := io.ReadAll(resp2.Body)
	body := string(bodyBytes)

	var videoURL, posterURL string
	ogVideo := regexp.MustCompile(`<meta\s+property=["']og:video:secure_url["']\s+content=["']([^"']+)["']`)
	if match := ogVideo.FindStringSubmatch(body); len(match) > 1 {
		videoURL = match[1]
	}

	ogImage := regexp.MustCompile(`<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']`)
	if match := ogImage.FindStringSubmatch(body); len(match) > 1 {
		posterURL = match[1]
	}

	return videoURL, posterURL, nil
}

func fixProtocolRelativeURL(u string) string {
	if strings.HasPrefix(u, "//") {
		return "https:" + u
	}
	return u
}

func downloadFile(url string, dest string, client *http.Client) error {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", UserAgentHeader)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

// GenerateComprehensiveTaskListMD formats ALL tasks across all states into Markdown Task Checklist
func GenerateComprehensiveTaskListMD(cfg PlaneConfig, backlog, todo, inProgress, done, cancelled, other []Issue, mediaMap map[int][]EvidenceMedia) string {
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

	formatIssueItem := func(checkbox string, item Issue) {
		sb.WriteString(fmt.Sprintf("- [%s] **PDFFILLSIG-%d**: %s\n", checkbox, item.SequenceID, item.Name))
		sb.WriteString(fmt.Sprintf("  - **Priority:** %s | **Start Date:** `%s`", formatPriority(item.Priority), formatDate(item.StartDate)))
		if item.UpdatedAt != "" {
			sb.WriteString(fmt.Sprintf(" | **Last Updated:** `%s`", formatDate(item.UpdatedAt)))
		}
		sb.WriteString("\n")

		if desc := cleanHTML(item.Description); desc != "" {
			sb.WriteString(fmt.Sprintf("  - **Details/Evidence:** %s\n", desc))
		}

		if mediaList, ok := mediaMap[item.SequenceID]; ok && len(mediaList) > 0 {
			sb.WriteString("  - **Downloaded Offline Evidence:**\n")
			for _, m := range mediaList {
				if m.Type == "image" {
					sb.WriteString(fmt.Sprintf("    - Screenshot: [%s](%s) → ![Preview](%s)\n", m.MediaID, m.WebURL, m.LocalPath))
				} else if m.Type == "video" {
					sb.WriteString(fmt.Sprintf("    - Video Recording: [%s](%s) → [Full MP4 Video](%s)\n", m.MediaID, m.WebURL, m.LocalPath))
					sb.WriteString(fmt.Sprintf("      <video controls src=\"%s\" poster=\"%s\" width=\"480\"></video>\n", m.LocalPath, m.PosterPath))
				}
			}
		}
		sb.WriteString("\n")
	}

	// 1. Backlog
	if len(backlog) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## 🔴 1. Backlog Tasks (%d)\n\n", len(backlog)))
		for _, item := range backlog {
			formatIssueItem(" ", item)
		}
	}

	// 2. Todo
	if len(todo) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## 🟡 2. Todo Tasks (%d)\n\n", len(todo)))
		for _, item := range todo {
			formatIssueItem(" ", item)
		}
	}

	// 3. In Progress
	if len(inProgress) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## 🔵 3. In Progress Tasks (%d)\n\n", len(inProgress)))
		for _, item := range inProgress {
			formatIssueItem("/", item)
		}
	}

	// 4. Done
	if len(done) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## 🟢 4. Done Tasks (%d)\n\n", len(done)))
		for _, item := range done {
			formatIssueItem("x", item)
		}
	}

	// 5. Cancelled
	if len(cancelled) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## ⚪ 5. Cancelled Tasks (%d)\n\n", len(cancelled)))
		for _, item := range cancelled {
			formatIssueItem(" ", item)
		}
	}

	// 6. Other / Draft
	if len(other) > 0 {
		sb.WriteString("--- \n\n")
		sb.WriteString(fmt.Sprintf("## ❓ 6. Other / Draft Tasks (%d)\n\n", len(other)))
		for _, item := range other {
			formatIssueItem(" ", item)
		}
	}

	sb.WriteString("---\n*Comprehensive task list generated automatically via Golang REST API client with evidence downloads.*")
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

func PrettyFormatJSON(input []byte) []byte {
	var prettyObj map[string]interface{}
	if err := json.Unmarshal(input, &prettyObj); err == nil {
		if formatted, err := json.MarshalIndent(prettyObj, "", "  "); err == nil {
			return formatted
		}
	}
	var prettyArr []interface{}
	if err := json.Unmarshal(input, &prettyArr); err == nil {
		if formatted, err := json.MarshalIndent(prettyArr, "", "  "); err == nil {
			return formatted
		}
	}
	return input
}

func ExcludePlaneDirectoryFromGit(worktreePath string) {
	excludeFile := filepath.Join(worktreePath, ".git", "info", "exclude")
	out, err := exec.Command("git", "-C", worktreePath, "rev-parse", "--git-path", "info/exclude").Output()
	if err == nil {
		relPath := strings.TrimSpace(string(out))
		if relPath != "" {
			if filepath.IsAbs(relPath) {
				excludeFile = relPath
			} else {
				excludeFile = filepath.Join(worktreePath, relPath)
			}
		}
	}

	gitInfoDir := filepath.Dir(excludeFile)
	_ = os.MkdirAll(gitInfoDir, 0755)

	content := ""
	if data, err := os.ReadFile(excludeFile); err == nil {
		content = string(data)
	}

	lines := strings.Split(content, "\n")
	hasPlanePattern := false
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed == "plane/" || trimmed == "plane/*" {
			hasPlanePattern = true
			break
		}
	}

	if !hasPlanePattern {
		if content != "" && !strings.HasSuffix(content, "\n") {
			content += "\n"
		}
		content += "\n# Exclude Plane Task Export Directory\nplane/\nplane/*\n"
		_ = os.WriteFile(excludeFile, []byte(content), 0644)
	}
}
