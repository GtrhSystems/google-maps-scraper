//go:build linux

package webrunner

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// killDescendants envía SIGKILL a todos los descendientes de este proceso.
func killDescendants() {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return
	}

	children := map[int][]int{}

	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}

		stat, err := os.ReadFile(filepath.Join("/proc", e.Name(), "stat"))
		if err != nil {
			continue
		}

		// Formato: pid (comm) estado ppid …; comm puede contener espacios y paréntesis.
		s := string(stat)

		fields := strings.Fields(s[strings.LastIndexByte(s, ')')+1:])
		if len(fields) < 2 {
			continue
		}

		if ppid, err := strconv.Atoi(fields[1]); err == nil {
			children[ppid] = append(children[ppid], pid)
		}
	}

	pending := children[os.Getpid()]
	for len(pending) > 0 {
		pid := pending[0]
		pending = append(pending[1:], children[pid]...)

		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
}
