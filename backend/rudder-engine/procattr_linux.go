//go:build linux

package main

import "syscall"

// childAttr: a child process (the speech server, a recorder) is killed with the engine, so a crash
// never leaves a speech server holding a gigabyte of memory. Linux only: Pdeathsig does not exist on
// macOS or Windows (see procattr_other.go).
func childAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
}

// yieldCPU lowers a background helper's CPU priority (nice 10), so on a thin client the live transcription
// always wins the CPU over it. Used for the robot voice: its ~1 s burst per sentence must never make the
// words you are speaking fall behind.
func yieldCPU(pid int) {
	_ = syscall.Setpriority(syscall.PRIO_PROCESS, pid, 10)
}
