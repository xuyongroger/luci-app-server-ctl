#
# luci-app-server-ctl - manual and scheduled power control for LAN servers
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Server Control
LUCI_DESCRIPTION:=Manual and scheduled Wake-on-LAN, suspend and power-off control for LAN servers via etherwake and SSH.
LUCI_DEPENDS:=+luci-base +etherwake +sshpass +openssh-client
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=luci-plugin

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
