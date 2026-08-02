package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

func main() {
	apiKey := "plane_api_468d764bbdbe4b87ae158976ac2e1559"
	client := &http.Client{Timeout: 10 * time.Second}

	// Fetch states mapping
	statesURL := "https://plane.itgproduct.com/api/v1/workspaces/product/projects/72f1bdd9-8420-469f-93f7-fe27b6658b9c/states/"
	sreq, _ := http.NewRequest("GET", statesURL, nil)
	sreq.Header.Set("X-API-Key", apiKey)
	sresp, err := client.Do(sreq)
	
	stateMap := make(map[string]map[string]string)

	if err == nil {
		sbody, _ := io.ReadAll(sresp.Body)
		sresp.Body.Close()

		var statesList []map[string]interface{}
		json.Unmarshal(sbody, &statesList)

		// Try unmarshaling if wrapped in results
		if len(statesList) == 0 {
			var wrapped map[string]interface{}
			json.Unmarshal(sbody, &wrapped)
			if res, ok := wrapped["results"].([]interface{}); ok {
				for _, item := range res {
					if m, ok := item.(map[string]interface{}); ok {
						id, _ := m["id"].(string)
						name, _ := m["name"].(string)
						group, _ := m["group"].(string)
						stateMap[id] = map[string]string{"name": name, "group": group}
					}
				}
			}
		} else {
			for _, m := range statesList {
				id, _ := m["id"].(string)
				name, _ := m["name"].(string)
				group, _ := m["group"].(string)
				stateMap[id] = map[string]string{"name": name, "group": group}
			}
		}
	}

	fmt.Printf("Mapped %d states from project states API!\n", len(stateMap))
	for id, s := range stateMap {
		fmt.Printf("  State ID [%s] -> Name: %-15s | Group: %s\n", id, s["name"], s["group"])
	}

	// Fetch issues
	issuesURL := "https://plane.itgproduct.com/api/v1/workspaces/product/projects/72f1bdd9-8420-469f-93f7-fe27b6658b9c/issues/"
	ireq, _ := http.NewRequest("GET", issuesURL, nil)
	ireq.Header.Set("X-API-Key", apiKey)
	iresp, _ := client.Do(ireq)
	ibody, _ := io.ReadAll(iresp.Body)
	iresp.Body.Close()

	var iraw map[string]interface{}
	json.Unmarshal(ibody, &iraw)
	results := iraw["results"].([]interface{})

	var backlogCount, todoCount int
	for _, item := range results {
		m := item.(map[string]interface{})
		stateID, _ := m["state"].(string)
		seqID := int(m["sequence_id"].(float64))
		name, _ := m["name"].(string)
		
		stateInfo := stateMap[stateID]
		stateName := stateInfo["name"]
		stateGroup := stateInfo["group"]

		if stateGroup == "backlog" || stateName == "Backlog" {
			backlogCount++
			fmt.Printf("[BACKLOG] PDFFILLSIG-%d: %s\n", seqID, name)
		} else if stateGroup == "unstarted" || stateName == "Todo" {
			todoCount++
			fmt.Printf("[TODO]    PDFFILLSIG-%d: %s\n", seqID, name)
		}
	}

	fmt.Printf("\nSummary: Backlog=%d, Todo=%d\n", backlogCount, todoCount)
}
